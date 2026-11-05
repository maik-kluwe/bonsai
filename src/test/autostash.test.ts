import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { existsSync } from 'fs';
import * as path from 'path';
import { parseStagedRaw, restoreIndexInfo } from '../operations';
import type { PlanEntry } from '../gitService';
import { TestRepo } from './helpers';

const repos: TestRepo[] = [];
const create = () => { const r = new TestRepo(); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

const ZERO = '0'.repeat(40);
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const NUL = '\x00';

describe('parseStagedRaw', () => {
  test('reads status, modes, blobs and the path of every entry', () => {
    const out = [
      `:100644 100644 ${A} ${B} M`, 'a.txt',
      `:000000 100644 ${ZERO} ${C} A`, 'dir/new file.txt',
      `:100644 000000 ${A} ${ZERO} D`, 'gone.txt', '',
    ].join(NUL);
    assert.deepEqual(parseStagedRaw(out), [
      { status: 'M', mode: '100644', oldOid: A, oid: B, path: 'a.txt' },
      { status: 'A', mode: '100644', oldOid: ZERO, oid: C, path: 'dir/new file.txt' },
      { status: 'D', mode: '000000', oldOid: A, oid: ZERO, path: 'gone.txt' },
    ]);
    assert.deepEqual(parseStagedRaw(''), []);
  });
});

describe('restoreIndexInfo', () => {
  const entries = parseStagedRaw([
    `:100644 100644 ${A} ${B} M`, 'm.txt',
    `:000000 100644 ${ZERO} ${C} A`, 'n.txt',
    `:100644 000000 ${A} ${ZERO} D`, 'd.txt', '',
  ].join(NUL));

  test('restores what HEAD still has as before: modified, added and deleted files', () => {
    const heads = new Map([['m.txt', A], ['d.txt', A]]);
    assert.equal(restoreIndexInfo(entries, heads), `100644 ${B}\tm.txt${NUL}100644 ${C}\tn.txt${NUL}0 ${ZERO}\td.txt${NUL}`);
  });

  test('skips a file the rebase changed in HEAD, and a new file that HEAD now has', () => {
    const heads = new Map([['m.txt', C], ['n.txt', B], ['d.txt', A]]);
    assert.equal(restoreIndexInfo(entries, heads), `0 ${ZERO}\td.txt${NUL}`);
  });
});

/**
 * main: base (a, b, c) -> m1 (adds m.txt)      topic: base -> t1 (adds t.txt)      HEAD on topic.
 * Working tree: a.txt staged, b.txt edited but not staged, n.txt new and staged, c.txt deleted and staged.
 */
function dirty(r: TestRepo) {
  r.commitFile('a.txt', 'a1\na2\na3\n', 'base');
  r.commitFile('b.txt', 'b\n', 'adds b');
  r.commitFile('c.txt', 'c\n', 'adds c');
  r.git('branch', 'topic');
  r.commitFile('m.txt', 'm\n', 'm1');
  r.git('checkout', '-q', 'topic');
  r.commitFile('t.txt', 't\n', 't1');
  r.write('a.txt', 'A1\na2\na3\n');
  r.git('add', 'a.txt');
  r.write('b.txt', 'B\n');
  r.write('n.txt', 'n\n');
  r.git('add', 'n.txt');
  r.git('rm', '-q', 'c.txt');
}
const status = (r: TestRepo) => r.status().sort();
const WANT = ['A  n.txt', 'D  c.txt', 'M  a.txt', ' M b.txt'].sort();
const leftovers = (r: TestRepo) => existsSync(path.join(r.dir, '.git', 'bonsai-rebase'));

/** base (a, b) -> m1 edits a.txt on main; t1 edits a.txt on topic (conflicts); b.txt is staged on top. HEAD on topic. */
function conflicting(r: TestRepo) {
  r.commitFile('a.txt', 'one\n', 'base');
  r.commitFile('b.txt', 'b\n', 'adds b');
  r.git('branch', 'topic');
  r.commitFile('a.txt', 'MAIN\n', 'm1');
  r.git('checkout', '-q', 'topic');
  r.commitFile('a.txt', 'TOPIC\n', 't1');
  r.write('b.txt', 'B\n');
  r.git('add', 'b.txt');
}

describe('rebase with autostash', () => {
  test('staged stays staged, unstaged stays unstaged, new and deleted files included', async () => {
    const r = create();
    dirty(r);
    assert.deepEqual(status(r), WANT, 'the starting point');
    assert.deepEqual(await r.svc.rebase('main', { autostash: true }), { conflicted: false });
    assert.deepEqual(status(r), WANT);
    assert.equal(r.git('log', '--format=%s', '-2').trim(), 't1\nm1');
    assert.equal(r.git('show', ':a.txt'), 'A1\na2\na3\n');
    assert.equal(leftovers(r), false);
  });

  test('a file staged and then edited further keeps both states', async () => {
    const r = create();
    dirty(r);
    r.write('a.txt', 'A1\na2\nA3\n'); // the index has A1 only
    await r.svc.rebase('main', { autostash: true });
    assert.deepEqual(status(r), ['A  n.txt', 'D  c.txt', 'MM a.txt', ' M b.txt'].sort());
    assert.equal(r.git('show', ':a.txt'), 'A1\na2\na3\n');
  });

  test('a file the rebase itself changed stays unstaged, so that nothing of upstream is staged as a revert', async () => {
    const r = create();
    r.commitFile('a.txt', 'a1\na2\na3\n', 'base');
    r.git('branch', 'topic');
    r.commitFile('a.txt', 'a1\na2\nUP\n', 'upstream edits the last line');
    r.git('checkout', '-q', 'topic');
    r.commitFile('t.txt', 't\n', 't1');
    r.write('a.txt', 'A1\na2\na3\n');
    r.git('add', 'a.txt');
    await r.svc.rebase('main', { autostash: true });
    assert.deepEqual(status(r), [' M a.txt']);
    assert.equal(r.git('show', ':a.txt'), 'a1\na2\nUP\n', 'the index is HEAD, untouched');
    assert.equal(r.git('diff', '--cached', '--stat').trim(), '');
  });

  test('a rebase that cannot start leaves nothing behind', async () => {
    const r = create();
    dirty(r);
    await assert.rejects(r.svc.rebase('no-such-branch', { autostash: true }));
    assert.equal(leftovers(r), false);
    assert.deepEqual(status(r), WANT, 'and nothing was touched');
  });

  test('a conflict in between: after continue the staged files are staged again', async () => {
    const r = create();
    conflicting(r);
    assert.equal((await r.svc.rebase('main', { autostash: true })).conflicted, true);
    assert.ok(leftovers(r), 'the note must outlast the stop');
    r.write('a.txt', 'resolved\n');
    r.git('add', 'a.txt');
    assert.deepEqual(await r.svc.rebaseContinue(), { conflicted: false });
    assert.deepEqual(status(r), ['M  b.txt']);
    assert.equal(leftovers(r), false);
  });

  test('abort brings the staged files back as staged as well', async () => {
    const r = create();
    conflicting(r);
    await r.svc.rebase('main', { autostash: true });
    await r.svc.abort('rebase');
    assert.deepEqual(status(r), ['M  b.txt']);
    assert.equal(leftovers(r), false);
  });

  test('an interactive rebase restores the staging as well', async () => {
    const r = create();
    dirty(r);
    const range = await r.svc.rebaseRange(r.git('rev-parse', 'HEAD').trim());
    const entries: PlanEntry[] = range.commits.map(c => ({ ...c, action: 'reword' as const, edited: 'renamed' }));
    assert.deepEqual(await r.svc.interactiveRebase(range.base, entries, { autostash: true }), { conflicted: false });
    assert.equal(r.git('log', '-1', '--format=%s').trim(), 'renamed');
    assert.deepEqual(status(r), WANT);
  });
});
