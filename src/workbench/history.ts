import type { Assembly } from './identity';
import type { ContentPart } from './attachments';
export interface HistoryConfig { history: 'transcript' | 'perspective' }
export type RequestMessage = { role: string; content: string | ContentPart[] };
export function historyConfig(version: Assembly | undefined, config: HistoryConfig | undefined): HistoryConfig {
  if(config!==undefined && (version!=='v2'||!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).join()!=='history'||!['transcript','perspective'].includes(config.history)))throw Error('Invalid assembly configuration: history requires v2 and must be transcript or perspective, with no extra fields');
  return config ?? {history:'transcript'};
}
export function appendContent(message:RequestMessage, content:string|ContentPart[]) {
  if(typeof message.content==='string'&&typeof content==='string')message.content+='\n\n'+content;
  else message.content=[...(typeof message.content==='string'?[{type:'text' as const,text:message.content}]:message.content),{type:'text',text:'\n\n'},...(typeof content==='string'?[{type:'text' as const,text:content}]:content)];
}
export function assertPerspective(messages:RequestMessage[]) {
  const dialogue=messages[0]?.role==='system'?messages.slice(1):messages;
  if(!dialogue.length||dialogue.length%2!==1||dialogue.some((m,i)=>m.role!==(i%2?'assistant':'user')||(typeof m.content==='string'?!m.content.trim():!m.content.length||!m.content.some(p=>p.type==='image_url'||p.text.trim()))||m.role==='assistant'&&Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')))throw Error('Invalid perspective request: dialogue must start with user, alternate roles, and end with a non-empty user turn; assistant images are unsupported');
}
