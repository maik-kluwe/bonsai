import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { WebviewPage } from './dom';
import type { PullInfo, ToWebview } from '../protocol';

// The real main view in a DOM: the page and the scripts as the webview loads them, fed with the messages of the host.
// What the user sees (text, boxes, hidden or shown) and what the view posts back are checked here, without VS Code and without a picture.

const data = (over: Partial<Extract<ToWebview, { type: 'data' }>> = {}): ToWebview => ({
  type: 'data', commits: [], more: false, rows: [], refs: [], maxWidth: 0, staged: [], unstaged: [], changeCount: 0, currentBranch: 'main', ...over,
});

const HASH = 'a'.repeat(40);
const info = { hash: HASH, parents: [], author: 'Ada', email: 'ada@example.org', date: 1700000000, subject: 'Fix the thing' };
const withCommit = data({ commits: [info], rows: [{ col: 0, color: 0, segments: [], width: 1 }], head: HASH });
const answer: ToWebview = { type: 'details', details: { ...info, body: '', committer: 'Ada', committerDate: 1700000000, files: [{ status: 'M', path: 'src/a.ts' }] } };

const pullInfo = (over: Partial<PullInfo> = {}): ToWebview => ({
  type: 'pullInfo',
  info: { upstream: 'origin/main', into: 'main', behind: 2, changes: 1, overwritten: ['a.txt'], reapplyConflicts: [], rebase: false, ...over },
});

let page: WebviewPage;
const open = () => { page = new WebviewPage(); page.send(data()); return page; };
afterEach(() => page?.close());

describe('the page starts', () => {
  test('all scripts load and the first data renders without a script error', () => {
    open();
    assert.deepEqual(page.errors, []);
  });
});

describe('the details panel', () => {
  test('is out of the way until a commit is chosen, comes with the commit and goes with the Hide button', () => {
    open();
    page.send(withCommit);
    assert.ok(page.$('#details').classList.contains('collapsed'), 'nothing chosen: only the list');

    page.click('.row');
    assert.deepEqual(page.sentOf('details'), [{ type: 'details', hash: HASH, stash: false }], 'the click asks the host');
    page.send(answer);
    assert.equal(page.$('#details').classList.contains('collapsed'), false);
    assert.match(page.text('#details'), /Fix the thing/);
    assert.match(page.text('#details'), /Ada <ada@example\.org>/);

    page.click('#details .dtoggle');
    assert.ok(page.$('#details').classList.contains('collapsed'), 'Hide leaves only the tabs');
    assert.deepEqual(page.errors, []);
  });
});

describe('the pull dialog', () => {
  test('says why a merge would be refused, and Pull sends the boxes as ticked', () => {
    open();
    page.send(pullInfo());
    assert.equal(page.$('#pulldlg').hidden, false);
    assert.equal(page.$<HTMLInputElement>('#pulldlg [data-pullopt="stash"]').checked, false, 'it never ticks a box itself');
    assert.match(page.text('#pulldlg .phint'), /a\.txt/, 'names the file that blocks the merge');

    page.$<HTMLInputElement>('#pulldlg [data-pullopt="stash"]').click();
    assert.equal(page.$<HTMLInputElement>('#pulldlg [data-pullopt="stash"]').checked, true);

    page.click('#pulldlg [data-pullact="pull"]');
    assert.deepEqual(page.sentOf('pull'), [{ type: 'pull', rebase: false, stash: true }]);
    assert.equal(page.$('#pulldlg').hidden, true, 'the dialog closes with the pull');
  });

  test('starts with what the user ticked last time', () => {
    open();
    page.send(pullInfo({ last: { rebase: true, stash: true } }));
    assert.equal(page.$<HTMLInputElement>('#pulldlg [data-pullopt="rebase"]').checked, true);
    assert.equal(page.$<HTMLInputElement>('#pulldlg [data-pullopt="stash"]').checked, true);
  });
});

describe('the conflict overlay', () => {
  test('lists the files and offers to resolve them', () => {
    open();
    page.send({ type: 'conflicts', files: ['a.txt', 'b.txt'], output: 'CONFLICT (content): Merge conflict in a.txt' });
    assert.equal(page.$('#conflictdlg').hidden, false);
    assert.match(page.text('#conflictdlg'), /a\.txt/);
    assert.match(page.text('#conflictdlg'), /b\.txt/);
  });
});
