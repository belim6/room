import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import * as model from '../web/model.mjs';
const { parseOfficeRoute, officeRouteHash, boardUnread, boardAuthorName, boardTokens, boardLinkTarget, boardMessageView, boardDraft, boardMentionCompletions, boardForkHeader } = model as any;
const msg = (n: number, kind = 'session', role = 'operator', extra: any = {}) => ({ id: `w-${String(n).padStart(6, '0')}`, at: '2026-10-29T10:00:00.000Z', room: 'work', author: { role, kind }, text: 'x', mentions: [], ...extra });

test('board routes parse and print; old routes are unchanged', () => {
  assert.deepEqual(parseOfficeRoute('#/board/work'), { page: 'board', room: 'work' });
  assert.deepEqual(parseOfficeRoute('#/board/leisure'), { page: 'board', room: 'leisure' });
  assert.deepEqual(parseOfficeRoute('#/board'), { page: 'board', room: 'work' });
  assert.deepEqual(parseOfficeRoute('#/board/elsewhere'), { page: 'board', room: 'work' });
  assert.equal(officeRouteHash({ page: 'board', room: 'leisure' }), '#/board/leisure');
  assert.equal(officeRouteHash({ page: 'board', room: 'bogus' }), '#/board/work');
  assert.deepEqual(parseOfficeRoute('#/'), { page: 'home' });
  assert.deepEqual(parseOfficeRoute('#/boardroom'), { page: 'home' });
  assert.deepEqual(parseOfficeRoute('#/op/board/floor'), { page: 'operation', id: 'board', tab: 'floor' });
});

test('unread counts messages after the last seen id, never Deniz\'s own, and all when never seen', () => {
  const list = [msg(1), msg(2, 'human', 'deniz'), msg(3, 'standin', 'partner'), msg(4)];
  assert.equal(boardUnread(list, null), 3);
  assert.equal(boardUnread(list, 'w-000002'), 2);
  assert.equal(boardUnread(list, 'w-000004'), 0);
  assert.equal(boardUnread([], 'w-000004'), 0);
});

test('fork replies and leisure mentions are always labelled as forks', () => {
  assert.equal(boardAuthorName({ role: 'partner', kind: 'standin' }), 'partner (fork)');
  assert.equal(boardAuthorName({ role: 'partner', kind: 'session' }), 'partner');
  assert.equal(boardAuthorName({ role: 'deniz', kind: 'human' }), 'Deniz');
  const v = boardMessageView(msg(5, 'standin', 'intern', { room: 'leisure' }));
  assert.equal(v.author, 'intern (fork)'); assert.equal(v.kind, 'standin');
});

test('tokens chip known @roles and multi-part node ids; unknown roles, emails and plain words stay text', () => {
  const ids = new Set(['office-message-board', 'office', '2026-10-17/date/labeling']);
  const t = boardTokens('@partner see office-message-board, office and (2026-10-17/date/labeling). @critic a@partner x', ids);
  assert.deepEqual(t.filter((x: any) => x.t !== 'text').map((x: any) => [x.t, x.v]), [['mention', '@partner'], ['node', 'office-message-board'], ['node', '2026-10-17/date/labeling']]);
  assert.equal(t.map((x: any) => x.v).join(''), '@partner see office-message-board, office and (2026-10-17/date/labeling). @critic a@partner x');
  assert.deepEqual(boardTokens('line one\nline  two', ids), [{ t: 'text', v: 'line one\nline  two' }]);
});

test('links open nodes or files; URLs and words stay text', () => {
  const ids = new Set(['office']);
  assert.deepEqual(boardLinkTarget('office', ids), { type: 'node', id: 'office' });
  assert.deepEqual(boardLinkTarget('work/office/x.md', ids), { type: 'file', path: '~/dev/room/work/office/x.md' });
  assert.deepEqual(boardLinkTarget('/Users/d/dev/room/a.md', ids), { type: 'file', path: '/Users/d/dev/room/a.md' });
  assert.deepEqual(boardLinkTarget('https://example.com/a', ids), { type: 'text' });
  assert.deepEqual(boardLinkTarget('nothing', ids), { type: 'text' });
  assert.equal(boardLinkTarget(undefined, ids), null);
});

test('message view-model: relative time, withheld text muted with no link or chips, reply context', () => {
  const now = Date.parse('2026-10-29T10:05:00.000Z'), parent = msg(1, 'human', 'deniz', { text: 'the parent message' });
  const v = boardMessageView(msg(2, 'session', 'engineer', { text: '@partner hi', replyTo: 'w-000001', link: 'office' }), { now, nodeIds: new Set(['office']), byId: new Map([['w-000001', parent]]) });
  assert.equal(v.ago, '5 min ago'); assert.equal(v.withheld, false); assert.deepEqual(v.link.target, { type: 'node', id: 'office' });
  assert.deepEqual(v.replyTo, { id: 'w-000001', author: 'Deniz', snippet: 'the parent message' });
  const w = boardMessageView(msg(3, 'session', 'engineer', { text: 'withheld by the Office deny-list' }), { now });
  assert.equal(w.withheld, true); assert.equal(w.link, null); assert.deepEqual(w.tokens, [{ t: 'text', v: 'withheld by the Office deny-list' }]);
  assert.equal(boardMessageView(msg(4, 'session', 'x', { replyTo: 'w-000009' })).replyTo.author, null);
});

test('draft check mirrors the API: counter n/2000, code points, one line-break run', () => {
  assert.deepEqual(boardDraft(''), { count: '0/2000', over: false, problem: 'empty' });
  assert.equal(boardDraft('hi').problem, '');
  assert.equal(boardDraft('😀'.repeat(2000)).count, '2000/2000');
  assert.equal(boardDraft('😀'.repeat(2000)).problem, '');
  const over = boardDraft('a'.repeat(2003)); assert.equal(over.over, true); assert.equal(over.problem, '3 characters over the limit');
  assert.equal(boardDraft('a\n\nb').problem, '');
  assert.match(boardDraft('a\nb\nc').problem, /one line break/);
});

test('@ autocomplete filters roles at the caret and labels stand-ins in leisure', () => {
  const a = boardMentionCompletions('hey @pa', 7, 'work');
  assert.deepEqual(a.options.map((o: any) => o.label), ['partner']); assert.equal(a.start, 4); assert.equal(a.end, 7);
  assert.equal(boardMentionCompletions('hey @', 5, 'work').options.length, 9);
  assert.deepEqual(boardMentionCompletions('@pro', 4, 'leisure').options, [{ role: 'prompter', label: 'prompter (fork)' }]);
  assert.deepEqual(boardMentionCompletions('@corr', 5).options.map((o: any) => o.role), ['jev-correspondent']);
  assert.equal(boardMentionCompletions('mail a@pa', 9), null);
  assert.equal(boardMentionCompletions('@zz', 3), null);
  assert.equal(boardMentionCompletions('@critic', 7), null);
  assert.equal(boardMentionCompletions('no at here', 5), null);
});

test('leisure fork header exposes toggle state, count, cost and pending status', () => {
  assert.deepEqual(boardForkHeader({ enabled:false, usedToday:0, cap:20, avgWeighted:null },false), { toggle:'Leisure forks: off', count:'fork replies today 0/20 · unmeasured', pending:'' });
  assert.deepEqual(boardForkHeader({ enabled:true, usedToday:4, cap:20, avgWeighted:210000 },true), { toggle:'Leisure forks: on', count:'fork replies today 4/20 · ~210k weighted each', pending:'fork pending' });
  assert.equal(boardForkHeader({enabled:true},false,true).pending,'no reply arrived');
  assert.match(boardForkHeader({enabled:true,usedToday:3,unknownToday:2,cap:20,avgWeighted:null},false).count,/2 unknown/);
});
