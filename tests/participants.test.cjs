// Offline integration test: real command handler and selectors; Discord/API calls stubbed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-participants-'));
const originalCwd = process.cwd();
const originalTimeout = global.setTimeout;
const replies = [], sent = [], generated = [];
const state = global.__participantTest = { handlers: {}, sent, generated };
function stub(name, source) { fs.writeFileSync(path.join(dir, name + '.mjs'), source); }
async function run() {
  for (const name of ['discord', 'participants', 'personas/personas', 'jevSpeaker', 'speakerTurn', 'snapshot']) {
    let code = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src', name + '.ts'), 'utf8'));
    code = code.replace(/from "\.\/([^"\n]+)"/g, (_, dep) => `from "./${path.basename(dep)}.mjs"`)
      .replace('from "dotenv"', 'from "./dotenv.mjs"').replace('from "discord.js"', 'from "./discord-lib.mjs"');
    stub(path.basename(name), code);
  }
  stub('dotenv', 'export default {config(){}};');
  stub('discord-lib', `export class Message {} export const GatewayIntentBits = {}; export class Client {
    user = {tag:'test'}; on(event, fn) {globalThis.__participantTest.handlers[event] = fn;}
    once(event, fn) {if(event === 'clientReady') fn();} async login() {}
  }`);
  stub('modelRouter', `export const MODELS={kimi:'test'};
    export function initAssignments() {} export function getAllAssignments(){return [];}
    export function exportAssignments(){return {};} export function importAssignments(){}
    export function shuffleAssignments(){} export function setPersonaMode(){}
    export function getPersonaMode(){return 'manual';} export function setAssignment(){}
    export async function respondAs(persona,input,opts){globalThis.__participantTest.generated.push({persona,input,opts});return 'reply';}`);
  stub('webhooks', 'export async function sendViaWebhook(p,r){globalThis.__participantTest.sent.push(p);}');
  stub('personaState', 'export function dumpAllPersonaMemory(){} export function exportPersonaMemory(){return {};} export function importPersonaMemory(){}');
  stub('research', 'export const RESEARCH_TIMEOUT_MS=100; export class ResearchError extends Error {} export async function askCodex(){return {answer:"",sources:[],latencyMs:0,query:""};} export function researchContext(){return "";}');
  stub('jevLog', 'export function recordTurn(){} export function resetTurns(){} export function formatReport(){return "report";} export function saveTurnsFor(){return 0;} export function loadTurnsFor(){return 0;} export function turnCount(){return 0;}');
  process.chdir(dir);
  process.env.OPENGATEWAY_API_KEY = process.env.DISCORD_BOT_TOKEN = process.env.TYPESAFE_API_KEY = 'test';
  global.setTimeout = (...args) => originalTimeout(...args).unref();
  const load = name => import(pathToFileURL(path.join(dir, name + '.mjs')));
  const roster = await load('participants');
  assert.deepEqual(roster.parseParticipants('boris, ELORIN boris'), ['Boris', 'Elorin']);
  assert.throws(() => roster.parseParticipants('unknown'));
  assert.throws(() => roster.validateParticipants([]));
  const jev = await load('jevSpeaker');
  for (let i=0;i<50;i++) {
    assert.equal(jev.sampleFrom({Rook: 999}, 'Boris', ['Boris','Elorin']), 'Elorin');
    assert.equal(jev.sampleFrom({}, 'Boris', ['Boris']), 'Boris');
    assert.equal(jev.resolveJevPick({confidence:0, probabilities:{Rook:999}}, 'Boris', ['Boris','Elorin']).persona, 'Elorin');
  }
  let requestCount = 0;
  global.fetch = async (_, options) => {
    requestCount++;
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body.questions.next_speaker.criteria), ['Boris','Elorin']);
    return {ok:true,json:async()=>({answers:{next_speaker:{choice:'Elorin',confidence:0.8,probabilities:{Elorin:1,Rook:999}}}})};
  };
  await jev.askJev([], ['Boris']); assert.equal(requestCount,0);
  await jev.askJev([], ['Boris','Elorin']); assert.equal(requestCount,1);
  const {buildSpeakerInput} = await load('speakerTurn');
  assert(buildSpeakerInput('Boris','Rook: hello',['Boris']).includes('Current participants: Dennis, Boris.'));
  await load('discord');
  let id=0;
  const command=async content=>state.handlers.messageCreate({id:String(++id),author:{bot:false},content,reply:async s=>replies.push(s),react:async()=>{}});
  await command('/participants boris elorin');
  await command('/toggle boris');
  await command('/participants elorin'); // clears the now-ineligible lock
  await command('.'); assert.equal(sent.at(-1),'Elorin');
  const count=sent.length;
  await command('#boris hello'); await command('/toggle boris');
  assert.equal(sent.length,count); assert(replies.at(-1).includes('not participating'));
  await command('/participants invalid'); await command('.'); assert.equal(sent.at(-1),'Elorin');
  assert(!generated.at(-1).input.includes('Dennis: hello')); // inactive direct call not added to history
  await command('/save test');
  assert.deepEqual(JSON.parse(fs.readFileSync('saves/test.json')).participants,['Elorin']);
  await command('/participants all'); await command('/load test');
  await command('/participants'); assert(replies.at(-1).startsWith('**Participants:** Elorin\n'));
  await command('/select jev'); await command('.'); assert.equal(sent.at(-1),'Elorin');
  await command('/participants boris elorin'); await command('.'); assert(['Boris','Elorin'].includes(sent.at(-1)));
  global.fetch=async()=>{throw Error('simulated outage')};
  await command('.'); assert(['Boris','Elorin'].includes(sent.at(-1))); // Jev fallback
  const legacy=JSON.parse(fs.readFileSync('saves/test.json')); delete legacy.participants;
  fs.writeFileSync('saves/legacy.json',JSON.stringify(legacy));
  await command('/load legacy'); await command('/participants');
  assert(replies.at(-1).includes(roster.ALL_PARTICIPANTS.join(', ')));
  console.log('PASS: commands, validation, locks, direct calls, random/Jev selection and fallback, single participant, prompt roster, save/load and legacy saves. No live services used.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  global.setTimeout=originalTimeout;process.chdir(originalCwd);fs.rmSync(dir,{recursive:true,force:true});
});
