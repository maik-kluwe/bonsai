import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createDetails }: { createDetails(deps: { post: (m: any) => void; look: any }): any } = require('../../media/details.js');
const { createLook }: { createLook(post: (m: any) => void): any } = require('../../media/look.js');

const file = (path: string, extra = {}) => ({ path, status: 'M', ...extra });
const commit = (hash: string, files = [file('a.txt'), file('b.txt')]) => ({ hash, parents: ['p1'], files });

function setup() {
  const sent: any[] = [];
  const post = (m: any) => sent.push(m);
  const look = createLook(post);
  const pane = createDetails({ post, look });
  const open = (hash = 'h1', files?: any[], isStash = false) => {
    pane.want(hash, isStash);
    assert.equal(pane.show(commit(hash, files), isStash), true);
    sent.length = 0;
  };
  return { pane, look, sent, open };
}

describe('details pane: which answer counts', () => {
  test('asking for a commit sends the request', () => {
    const { pane, sent } = setup();
    pane.want('h1', false);
    assert.deepEqual(sent, [{ type: 'details', hash: 'h1', stash: false }]);
    assert.equal(pane.hash, 'h1');
  });

  test('only the answer for the commit asked for last is shown', () => {
    const { pane } = setup();
    pane.want('h1', false);
    pane.want('h2', false);
    assert.equal(pane.show(commit('h1'), false), false);
    assert.equal(pane.current, undefined);
    assert.equal(pane.show(commit('h2'), false), true);
    assert.equal(pane.current.hash, 'h2');
  });

  test('after clear nothing is expected, so a late answer is dropped', () => {
    const { pane } = setup();
    pane.want('h1', false);
    pane.clear();
    assert.equal(pane.show(commit('h1'), false), false);
  });

  test('the stash flag goes onto the commit', () => {
    const { pane } = setup();
    pane.want('s1', true);
    pane.show(commit('s1'), true);
    assert.equal(pane.current.isStash, true);
  });

  test('another commit starts with empty caches; the same commit shown again keeps them', () => {
    const { pane, open } = setup();
    open('h1');
    pane.toggleFile('a.txt');
    pane.onFileDiff({ hash: 'h1', path: 'a.txt', hunks: [] });
    pane.pickChange('b.txt');
    pane.want('h1', false);
    pane.show(commit('h1'), false);
    assert.equal(pane.openFiles.has('a.txt'), true);
    assert.equal(pane.inlineDiffs.has('a.txt'), true);
    pane.want('h2', false);
    pane.show(commit('h2'), false);
    assert.equal(pane.openFiles.size, 0);
    assert.equal(pane.inlineDiffs.size, 0);
    assert.equal(pane.changesPath, '');
  });
});

describe('details pane: commit tab', () => {
  test('expanding a file asks for its diff once; expanding it again does not ask when it is here', () => {
    const { pane, sent, open } = setup();
    open();
    pane.toggleFile('a.txt');
    assert.deepEqual(sent, [{ type: 'fileDiff', hash: 'h1', parent: 'p1', path: 'a.txt', status: 'M' }]);
    assert.equal(pane.onFileDiff({ hash: 'h1', path: 'a.txt', hunks: [] }), 'files');
    pane.toggleFile('a.txt');
    pane.toggleFile('a.txt');
    assert.equal(sent.length, 1);
  });

  test('a diff for a file that is not expanded is kept but needs no redraw', () => {
    const { pane, open } = setup();
    open();
    assert.equal(pane.onFileDiff({ hash: 'h1', path: 'a.txt', hunks: [] }), null);
    assert.equal(pane.inlineDiffs.has('a.txt'), true);
  });

  test('a diff for another commit is dropped', () => {
    const { pane, open } = setup();
    open();
    assert.equal(pane.onFileDiff({ hash: 'other', path: 'a.txt', hunks: [] }), null);
    assert.equal(pane.inlineDiffs.size, 0);
  });

  test('a rename carries its old path into the request', () => {
    const { pane, sent, open } = setup();
    open('h1', [file('new.txt', { oldPath: 'old.txt', status: 'R' })]);
    pane.toggleFile('new.txt');
    assert.equal(sent[0].oldPath, 'old.txt');
  });
});

describe('details pane: Changes tab', () => {
  test('switching tabs reports a change only when there is one, and not without a commit', () => {
    const { pane, open } = setup();
    assert.equal(pane.setTab('changes'), false);
    open();
    assert.equal(pane.setTab('commit'), false);
    assert.equal(pane.setTab('changes'), true);
    assert.equal(pane.tab, 'changes');
    assert.equal(pane.setTab('changes'), false);
  });

  test('entering the tab picks the first file and asks for its diff with the look of the toolbar', () => {
    const { pane, sent, open, look } = setup();
    open();
    look.apply({ ctx: 5, iws: true });
    pane.setTab('changes');
    pane.enterChanges();
    assert.equal(pane.changesPath, 'a.txt');
    assert.deepEqual(sent, [{ type: 'fileDiff', hash: 'h1', parent: 'p1', path: 'a.txt', status: 'M', context: 5, ignoreSpace: true }]);
  });

  test('entering the tab keeps the file that was picked, as long as the commit has it', () => {
    const { pane, open } = setup();
    open();
    pane.pickChange('b.txt');
    pane.enterChanges();
    assert.equal(pane.changesPath, 'b.txt');
  });

  test('an answer for the shown file redraws the diff; one for another file does not', () => {
    const { pane, open, look } = setup();
    open();
    pane.setTab('changes');
    pane.enterChanges();
    assert.equal(pane.onFileDiff({ hash: 'h1', path: 'a.txt', context: look.asked(), hunks: [] }), 'changes');
    assert.equal(pane.onFileDiff({ hash: 'h1', path: 'b.txt', context: look.asked(), hunks: [] }), null);
    assert.equal(pane.changeDiffs.has('b.txt'), true);
  });

  test('an answer for an outdated context or whitespace setting is dropped', () => {
    const { pane, open } = setup();
    open();
    pane.setTab('changes');
    pane.enterChanges();
    assert.equal(pane.onFileDiff({ hash: 'h1', path: 'a.txt', context: 99, hunks: [] }), null);
    assert.equal(pane.onFileDiff({ hash: 'h1', path: 'a.txt', context: 3, ignoreSpace: true, hunks: [] }), null);
    assert.equal(pane.changeDiffs.size, 0);
  });

  test('a toolbar change that needs other diffs empties the cache and asks again; one that does not leaves it', () => {
    const { pane, sent, open, look } = setup();
    open();
    pane.setTab('changes');
    pane.enterChanges();
    pane.onFileDiff({ hash: 'h1', path: 'a.txt', context: look.asked(), hunks: [] });
    sent.length = 0;
    pane.changeLook('wrap');
    assert.deepEqual(sent.map(m => m.type), ['saveLook']);
    assert.equal(pane.changeDiffs.size, 1);
    sent.length = 0;
    pane.changeLook('moreCtx');
    assert.deepEqual(sent.map(m => m.type), ['saveLook', 'fileDiff']);
    assert.equal(sent[1].context, 5);
    assert.equal(pane.changeDiffs.size, 0);
  });
});
