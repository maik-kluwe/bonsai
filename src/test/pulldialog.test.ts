import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createPullDialog, needsStash, fileList }: { createPullDialog(deps: any): any; needsStash(i: any, rebase: boolean): boolean; fileList(f: string[], max?: number): string } =
  require('../../media/pulldialog.js');
const { esc }: { esc(s: string): string } = require('../../media/diffhtml.js');

const info = (over: object = {}) => ({
  upstream: 'origin/main', into: 'main', behind: 2, changes: 0, overwritten: [] as string[], reapplyConflicts: [] as string[], rebase: false, ...over,
});

function setup(over: object = {}) {
  const sent: any[] = [];
  const t = (k: string, ...a: unknown[]) => `${k}${a.length ? `(${a.join(',')})` : ''}`;
  const dialog = createPullDialog({ t, esc, post: (m: any) => sent.push(m) });
  dialog.open(info(over));
  return { dialog, sent };
}
const checked = (html: string, name: string) => new RegExp(`data-pullopt="${name}" checked`).test(html);

describe('when Git needs the local changes out of the way', () => {
  test('a merge is refused for files the incoming commits change; a rebase for any local change; nothing new, nothing to refuse', () => {
    assert.equal(needsStash(info({ changes: 1, overwritten: ['a.txt'] }), false), true);
    assert.equal(needsStash(info({ changes: 1 }), false), false, 'other files: the merge goes through');
    assert.equal(needsStash(info({ changes: 1 }), true), true);
    assert.equal(needsStash(info({ changes: 0 }), true), false);
    assert.equal(needsStash(info({ changes: 1, overwritten: ['a.txt'], behind: 0 }), false), false);
  });

  test('a long list of files is cut', () => {
    assert.equal(fileList(['a', 'b']), 'a, b');
    assert.equal(fileList(['a', 'b', 'c', 'd', 'e', 'f']), 'a, b, c, d +2');
  });
});

describe('pull dialog', () => {
  test('shows where from and where to, with nothing ticked when nothing was chosen before', () => {
    const html = setup().dialog.html();
    assert.match(html, /<b>origin\/main<\/b>/);
    assert.match(html, /pullBehind\(2\)/);
    assert.match(html, /<b>main<\/b>/);
    assert.equal(checked(html, 'rebase'), false);
    assert.equal(checked(html, 'stash'), false);
    assert.match(html, /class="phint" hidden/, 'no hint');
  });

  test('one new commit is not "1 new commits"', () => {
    assert.match(setup({ behind: 1 }).dialog.html(), /pullBehindOne/);
    assert.doesNotMatch(setup({ behind: 0 }).dialog.html(), /pullBehind/);
  });

  test('without an earlier choice "Rebase instead of merge" follows the Git settings; the stash box is off', () => {
    const html = setup({ rebase: true }).dialog.html();
    assert.equal(checked(html, 'rebase'), true);
    assert.equal(checked(html, 'stash'), false);
  });

  test('the boxes start as the user left them the last time, whatever the settings say', () => {
    const both = setup({ rebase: false, last: { rebase: true, stash: true } }).dialog.html();
    assert.equal(checked(both, 'rebase'), true);
    assert.equal(checked(both, 'stash'), true);
    const none = setup({ rebase: true, last: { rebase: false, stash: false } }).dialog.html();
    assert.equal(checked(none, 'rebase'), false);
    assert.equal(checked(none, 'stash'), false);
  });

  test('no box is ticked on its own, not even when the pull could not run without it: the hint says so instead', () => {
    const { dialog } = setup({ changes: 2, overwritten: ['a.txt'], reapplyConflicts: [] });
    assert.equal(checked(dialog.html(), 'stash'), false);
    assert.deepEqual(dialog.hint(), { kind: 'warn', text: 'pullBlockedMerge(a.txt)' });
    dialog.setOption('rebase', true);
    assert.equal(dialog.options.stash, false, 'switching to rebase leaves the stash box alone, too');
    assert.deepEqual(dialog.hint(), { kind: 'warn', text: 'pullBlockedRebase' });
  });

  test('with the stash box ticked the hint turns to the way back: clean, or the files that would conflict', () => {
    const clean = setup({ changes: 1, overwritten: ['a.txt'], reapplyConflicts: [] }).dialog;
    clean.setOption('stash', true);
    assert.deepEqual(clean.hint(), { kind: 'info', text: 'pullReapplyClean' });

    const conflicting = setup({ changes: 1, overwritten: ['a.txt'], reapplyConflicts: ['a.txt'] }).dialog;
    conflicting.setOption('stash', true);
    assert.deepEqual(conflicting.hint(), { kind: 'warn', text: 'pullReapplyConflicts(a.txt)' });
  });

  test('without a prediction there is nothing to say about the way back', () => {
    const { dialog } = setup({ changes: 1, overwritten: ['a.txt'], reapplyConflicts: undefined, last: { rebase: false, stash: true } });
    assert.equal(dialog.hint(), null);
  });

  test('up to date: say so, whatever else is open', () => {
    const { dialog } = setup({ behind: 0, changes: 1, overwritten: ['a.txt'] });
    assert.deepEqual(dialog.hint(), { kind: 'info', text: 'pullUpToDate' });
  });

  test('Pull sends the boxes as they are, which the host keeps for next time; the dialog closes', () => {
    const a = setup({ changes: 0, last: { rebase: true, stash: true } });
    assert.equal(a.dialog.pull(), true);
    assert.deepEqual(a.sent, [{ type: 'pull', rebase: true, stash: true }]);
    assert.equal(a.dialog.isOpen, false);

    const b = setup();
    b.dialog.setOption('rebase', true);
    b.dialog.pull();
    assert.deepEqual(b.sent, [{ type: 'pull', rebase: true, stash: false }]);
  });

  test('a closed dialog sends nothing and draws nothing', () => {
    const { dialog, sent } = setup();
    dialog.close();
    assert.equal(dialog.pull(), false);
    assert.equal(dialog.html(), '');
    assert.deepEqual(sent, []);
  });

  test('names from the repository cannot break the page', () => {
    const html = setup({ upstream: 'origin/<b>x</b>', into: 'a"b' }).dialog.html();
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});
