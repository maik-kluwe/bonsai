import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

interface Diff { path: string; staged: boolean; hunks?: unknown; untracked?: boolean; conflict?: boolean }
const { createLocalDiff, diffUpdate, lineAction }: {
  createLocalDiff(deps: { post: (m: any) => void; look: any; lineSel: any }): any;
  diffUpdate(shown: Diff | null, incoming: Diff, selected: { path: string; staged: boolean } | null | undefined): { stale: boolean; sameFile: boolean; same: boolean; unchanged: boolean };
  lineAction(diff: Diff, status: string): null | 'stage' | 'unstage';
} = require('../../media/localdiff.js');
const { createLook }: { createLook(post: (m: any) => void): any } = require('../../media/look.js');
const { createLineSelection }: { createLineSelection(): any } = require('../../media/linesel.js');

describe('diffUpdate', () => {
  const hunks = [{ header: '@@', lines: [] }];

  test('drops a diff for something other than the current selection, or when nothing is selected', () => {
    assert.equal(diffUpdate(null, { path: 'a', staged: false }, { path: 'b', staged: false }).stale, true);
    assert.equal(diffUpdate(null, { path: 'a', staged: false }, { path: 'a', staged: true }).stale, true);
    assert.equal(diffUpdate(null, { path: 'a', staged: false }, null).stale, true);
    assert.equal(diffUpdate(null, { path: 'a', staged: false }, undefined).stale, true);
  });

  test('a new version of the shown file keeps the scroll position, and the marks only if the hunks are equal', () => {
    const shown = { path: 'a', staged: false, hunks };
    const sel = { path: 'a', staged: false };
    assert.deepEqual(diffUpdate(shown, { ...shown, hunks: [...hunks] }, sel), { stale: false, sameFile: true, same: true, unchanged: true });
    assert.deepEqual(diffUpdate(shown, { ...shown, hunks: [{ header: '@@ other', lines: [] }] }, sel), { stale: false, sameFile: true, same: false, unchanged: false });
  });

  test('equal hunks alone do not make a diff unchanged: a conflict has none, its sides can still differ', () => {
    const conflict = (sides: unknown) => ({ path: 'a', staged: false, conflict: true, sides } as Diff);
    const r = diffUpdate(conflict({ ours: 1 }), conflict({ ours: 2 }), { path: 'a', staged: false });
    assert.equal(r.same, true);
    assert.equal(r.unchanged, false);
  });

  test('the same file on the other side (staged vs. unstaged) is a different diff', () => {
    const r = diffUpdate({ path: 'a', staged: false, hunks }, { path: 'a', staged: true, hunks }, { path: 'a', staged: true });
    assert.deepEqual(r, { stale: false, sameFile: false, same: false, unchanged: false });
  });
});

describe('lineAction', () => {
  test('lines move in the direction of the side that is shown, not for untracked, conflicted, added or deleted files', () => {
    for (const [name, diff, status, want] of [
      ['unstaged', { path: 'f', staged: false }, 'M', 'stage'],
      ['staged', { path: 'f', staged: true }, 'M', 'unstage'],
      ['untracked', { path: 'f', staged: false, untracked: true }, 'U', null],
      ['conflicted', { path: 'f', staged: false, conflict: true }, 'U', null],
      ['added', { path: 'f', staged: true }, 'A', null],
      ['deleted', { path: 'f', staged: false }, 'D', null],
    ] as const) {
      assert.equal(lineAction(diff, status), want, name);
    }
  });
});

const hunkLines = [{ t: ' ', text: 'x' }, { t: '-', text: 'old' }, { t: '+', text: 'new' }, { t: '+', text: 'more' }];
const answer = (extra = {}) => ({ path: 'a.txt', staged: false, untracked: false, context: 3, hunks: [{ header: '@@', lines: hunkLines }], ...extra });
const target = { path: 'a.txt', staged: false };

function setup() {
  const sent: any[] = [];
  const post = (m: any) => sent.push(m);
  const look = createLook(post);
  const lineSel = createLineSelection();
  const local = createLocalDiff({ post, look, lineSel });
  return { local, look, lineSel, sent };
}

describe('createLocalDiff: answers', () => {
  test('asking for a diff names the context of the toolbar', () => {
    const { local, look, sent } = setup();
    local.load({ path: 'a.txt', staged: true });
    look.apply({ ctx: null });
    local.load({ path: 'b.txt', staged: false });
    local.load(null);
    assert.deepEqual(sent, [
      { type: 'loadDiff', path: 'a.txt', staged: true, context: 3 },
      { type: 'loadDiff', path: 'b.txt', staged: false, context: 100000 },
    ]);
  });

  test('a diff for the selected file is taken; a stale one is not', () => {
    const { local } = setup();
    assert.equal(local.receive(answer({ path: 'other.txt' }), target), null);
    assert.equal(local.shown, null);
    assert.deepEqual(local.receive(answer(), target), { stale: false, sameFile: false, same: false, unchanged: false });
    assert.equal(local.shown.path, 'a.txt');
  });

  test('a diff made with another context than the toolbar asks for now is dropped', () => {
    const { local, look } = setup();
    look.apply({ ctx: 10 });
    assert.equal(local.receive(answer({ context: 3 }), target), null);
    assert.notEqual(local.receive(answer({ context: 10 }), target), null);
  });

  test('marks stay while the hunks stay the same and are gone when they change', () => {
    const { local, lineSel } = setup();
    local.receive(answer(), target);
    local.mark(0, 2, {});
    assert.deepEqual(lineSel.lines(), [2]);
    assert.equal(local.receive(answer(), target)?.same, true);
    assert.deepEqual(lineSel.lines(), [2]);
    local.receive(answer({ hunks: [{ header: '@@ other', lines: hunkLines }] }), target);
    assert.deepEqual(lineSel.lines(), []);
  });

  test('a diff that comes back unchanged needs no drawing, unless the view was emptied in between', () => {
    const { local } = setup();
    local.receive(answer(), target);
    assert.equal(local.receive(answer(), target)?.unchanged, true);
    local.forget();
    assert.equal(local.shown, null);
    assert.equal(local.receive(answer(), target)?.unchanged, false);
  });

  test('drawing again is only possible with a diff on screen for the selected file', () => {
    const { local } = setup();
    assert.equal(local.again(target), null);
    local.receive(answer(), target);
    assert.equal(local.again(target)?.sameFile, true);
    assert.equal(local.again({ path: 'b.txt', staged: false }), null);
    assert.equal(local.again(null), null);
  });
});

describe('createLocalDiff: staging', () => {
  test('a hunk goes to the host with the context of the diff on screen', () => {
    const { local, sent } = setup();
    local.receive(answer({ context: 3, hunks: [{ header: '@@', lines: [] }, { header: '@@ 2', lines: hunkLines }] }), target);
    local.hunk(1, 'stage');
    assert.deepEqual(sent, [{ type: 'hunk', path: 'a.txt', staged: false, index: 1, action: 'stage', context: 3, expect: [' x', '-old', '+new', '+more'] }]);
  });

  test('that context stays that of the diff, even after the toolbar moved on', () => {
    const { local, look, sent } = setup();
    local.receive(answer({ context: 3 }), target);
    look.apply({ ctx: 10 });
    local.hunk(0, 'discard');
    assert.equal(sent[0].context, 3);
  });

  test('marked lines go with their hunk and are cleared afterwards', () => {
    const { local, lineSel, sent } = setup();
    local.receive(answer(), target);
    local.mark(0, 2, {});
    local.mark(0, 3, { ctrlKey: true });
    local.lines(0, 'stage');
    assert.deepEqual(sent, [{ type: 'lines', path: 'a.txt', staged: false, hunk: 0, lines: [2, 3], action: 'stage', context: 3, expect: [' x', '-old', '+new', '+more'] }]);
    assert.deepEqual(lineSel.lines(), []);
  });

  test('only changed lines can be marked', () => {
    const { local, lineSel } = setup();
    local.receive(answer({ hunks: [{ header: '@@', lines: [{ t: '-', text: 'old' }, { t: ' ', text: 'x' }, { t: '+', text: 'new' }] }] }), target);
    local.mark(0, 0, {});
    local.mark(0, 2, { shiftKey: true });
    assert.deepEqual(lineSel.lines(), [0, 2]);
  });

  test('a toolbar change that needs another diff clears the marks and fetches it again', () => {
    const { local, lineSel, sent } = setup();
    local.receive(answer(), target);
    local.mark(0, 2, {});
    local.changeLook('wrap');
    assert.deepEqual(sent.map(m => m.type), ['saveLook']);
    assert.deepEqual(lineSel.lines(), [2]);
    sent.length = 0;
    local.changeLook('moreCtx');
    assert.deepEqual(sent.map(m => m.type), ['saveLook', 'loadDiff']);
    assert.equal(sent[1].context, 5);
    assert.deepEqual(lineSel.lines(), []);
  });
});

describe('createLocalDiff: header buttons and conflicts', () => {
  test('buttons of the header go to the host; the merge dialog is the caller to open', () => {
    const { local, sent } = setup();
    local.receive(answer({ staged: true }), { path: 'a.txt', staged: true });
    for (const name of ['open', 'vsdiff', 'mergeEditor', 'resolveOurs', 'resolveTheirs']) assert.equal(local.fileAction(name), null);
    assert.equal(local.fileAction('merge'), 'merge');
    assert.deepEqual(sent, [
      { type: 'openFile', path: 'a.txt' },
      { type: 'openChange', path: 'a.txt', staged: true },
      { type: 'mergeEditor', path: 'a.txt' },
      { type: 'resolveUsing', side: 'ours', paths: ['a.txt'] },
      { type: 'resolveUsing', side: 'theirs', paths: ['a.txt'] },
    ]);
  });

  test('both sides are ticked for a new conflict file; another file starts over', () => {
    const { local } = setup();
    assert.deepEqual(local.picked('a'), { path: 'a', theirs: true, ours: true });
    local.setPick('ours', false);
    assert.equal(local.picked('a').ours, false);
    assert.deepEqual(local.picked('b'), { path: 'b', theirs: true, ours: true });
    assert.equal(local.picked('a').ours, true);
  });
});
