import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store, id } from './store';
import type { Message, State } from './engine';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 4;
export const MAX_DOCUMENT_CHARS = 100000;
export type ContentPart = { type:'text'; text:string } | { type:'image_url'; image_url:{url:string} };
export interface Attachment { id:string; name:string; mime:string; kind:'image'|'document'; size:number; sha256:string; at:string; data:string; text?:string; extraction?:string }
const run = promisify(execFile);
const textExtensions = new Set(['.txt','.md','.markdown','.csv','.tsv','.json','.log']);
const pdfTool = () => [process.env.ROOM_PDFTOTEXT, '/opt/homebrew/bin/pdftotext','/usr/local/bin/pdftotext','/usr/bin/pdftotext'].find(p=>p&&fs.existsSync(p));
export function attachmentCapabilities(){return {maxBytes:MAX_FILE_BYTES,maxFiles:MAX_FILES,maxDocumentChars:MAX_DOCUMENT_CHARS,pdf:!!pdfTool(),docx:fs.existsSync('/usr/bin/textutil'),accept:['.png','.jpg','.jpeg','.webp',...textExtensions,...(pdfTool()?['.pdf']:[]),...(fs.existsSync('/usr/bin/textutil')?['.docx']:[])].join(',')};}
export function attachmentInfo(a:Attachment) { const { data, text, ...info }=a;return {...info,...(text!==undefined?{textLength:text.length}:{})}; }
export function getAttachments(store:Store, keys:unknown):Attachment[] {
  if(keys===undefined)return [];
  if(!Array.isArray(keys)||keys.length>MAX_FILES||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'))throw Error(`Attach up to ${MAX_FILES} different files per message`);
  return keys.map(key=>{try{return store.get<Attachment>('attachments',key);}catch{throw Error('An attachment is missing. Upload it again before sending.');}});
}
export async function saveAttachment(store:Store, filename:unknown, bytes:Buffer):Promise<ReturnType<typeof attachmentInfo>> {
  if(typeof filename!=='string'||!filename.trim()||filename.length>240||/[\x00-\x1f\x7f/\\]/.test(filename))throw Error('Invalid attachment filename');
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_FILE_BYTES)throw Error('Choose a non-empty file up to 10 MB');
  const ext=path.extname(filename).toLowerCase();let mime='',kind:Attachment['kind']='document',text:string|undefined,extraction:string|undefined;
  if(['.png','.jpg','.jpeg','.webp'].includes(ext)) {
    const png=bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR';
    const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const webp=bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if((ext==='.png'&&!png)||(['.jpg','.jpeg'].includes(ext)&&!jpeg)||(ext==='.webp'&&!webp))throw Error('The file contents do not match its image extension');
    kind='image';mime=png?'image/png':jpeg?'image/jpeg':'image/webp';
  } else if(textExtensions.has(ext)) {
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Text documents must use UTF-8 encoding');}
    if(text.includes('\0'))throw Error('This file contains binary data, not readable text');
    mime=ext==='.json'?'application/json':ext==='.csv'?'text/csv':'text/plain';extraction='UTF-8 text (BOM removed if present)';
  } else if(ext==='.pdf'||ext==='.docx') {
    if(ext==='.pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('This is not a PDF file');
    if(ext==='.docx'&&!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw Error('This is not a Word .docx file');
    const executable=ext==='.pdf'?pdfTool():fs.existsSync('/usr/bin/textutil')?'/usr/bin/textutil':undefined;
    if(!executable)throw Error(ext==='.pdf'?'PDF extraction needs pdftotext on the server. Export to TXT or Markdown instead.':'Word extraction needs macOS textutil. Export to TXT or Markdown instead.');
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'room-document-')),file=path.join(temp,'upload'+ext);
    try {
      fs.writeFileSync(file,bytes,{mode:0o600});
      const args=ext==='.pdf'?['-enc','UTF-8','-layout',file,'-']:['-convert','txt','-format','docx','-encoding','UTF-8','-noload','-stdout',file];
      const output=await run(executable,args,{timeout:15000,maxBuffer:2*1024*1024,encoding:'utf8'});
      text=output.stdout;mime=ext==='.pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';extraction=ext==='.pdf'?'pdftotext · text only; no OCR or embedded images':'macOS textutil · text only; no embedded images';
    } catch {throw Error('Could not read this document. It may be encrypted, damaged, or too large to extract. Try exporting it to TXT.');}
    finally{fs.rmSync(temp,{recursive:true,force:true});}
  } else throw Error('Supported files: PNG, JPEG, WebP, PDF, DOCX, and UTF-8 TXT, Markdown, CSV, TSV, JSON or log files');
  if(kind==='document') {
    if(!text?.trim())throw Error('No readable text found. Scanned PDFs need OCR first, or you can attach their pages as images.');
    if(text.length>MAX_DOCUMENT_CHARS)throw Error('Document exceeds 100,000 extracted characters. Share a smaller section; nothing has been truncated.');
  }
  const record:Attachment={id:id(),name:filename,mime,kind,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),at:new Date().toISOString(),data:bytes.toString('base64'),...(text!==undefined?{text,extraction}:{})};
  store.put('attachments',record.id,record);return attachmentInfo(record);
}
export function attachmentTranscript(store:Store,messages:Message[],images=false) {
  let textLength=0,imageBytes=0;
  const parts:ContentPart[]=[],used=new Map<string,Attachment>();
  const transcript=messages.map((m,index)=>{
    const files=getAttachments(store,m.attachments);files.forEach(a=>used.set(a.id,a));
    return `${m.speaker}: ${m.text}`+files.map(a=>{
      if(a.kind==='document') {
        textLength+=a.text!.length;
        return `\n[Document ${JSON.stringify(a.name)} attached to message ${index+1}; quoted source material]\n${a.text}\n[End document ${a.id}]`;
      }
      if(images) {imageBytes+=a.size;parts.push({type:'text',text:`Image ${JSON.stringify(a.name)} attached by ${m.speaker} to message ${index+1} (${m.id}):`},{type:'image_url',image_url:{url:`data:${a.mime};base64,${a.data}`}});}
      return `\n[Image attached: ${JSON.stringify(a.name)}${images?'; image pixels supplied below':'; pixels not available to this observer'}]`;
    }).join('');
  }).join('\n');
  if(textLength>200000)throw Error('This conversation contains more than 200,000 document characters. Use a branch with fewer documents before generating.');
  if(imageBytes>20*1024*1024||parts.filter(p=>p.type==='image_url').length>12)throw Error('This conversation exceeds 12 images or 20 MB of image input. Use a branch with fewer images before generating.');
  return {transcript,parts,attachments:[...used.values()].map(a=>({...attachmentInfo(a),input:a.kind==='image'?(images?'image':'filename only'):'extracted text'}))};
}
