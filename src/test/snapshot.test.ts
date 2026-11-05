import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import type { ChangeItem } from '../changes';
import type { CommitInfo } from '../gitService';
import { GRAPH_MAX_LANES } from '../graph';
import { WORKTREE, buildSnapshot, mergeInfo, snapshotSignature, type SnapshotInput } from '../snapshot';
import { TestRepo } from './helpers';

const repos: TestRepo[] = [];
const create = () => { const r = new TestRepo(); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

const item = (p: string, status = 'M'): ChangeItem => ({ path: p, status, conflict: false });
const commit = (hash: string, parents: string[] = []): CommitInfo => ({ hash, parents, author: 'a', email: 'a@x', date: 1, subject: hash });

const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  commits: [commit('c2', ['c1']), commit('c1')], refs: [], head: 'c2', currentBranch: 'main',
  staged: [], unstaged: [], worktreeSubject: n => `Lokale Änderungen (${n})`, now: 1000, ...over,
});

describe('buildSnapshot', () => {
  test('without changes no "Local changes" row', () => {
    const s = buildSnapshot(input());
    assert.deepEqual(s.commits.map(c => c.hash), ['c2', 'c1']);
    assert.equal(s.changeCount, 0);
    assert.equal(s.rows.length, s.commits.length);
  });

  test('passes refs, lists, branch, merge and `more` through unchanged', () => {
    assert.equal(buildSnapshot(input()).more, false, 'more');
    assert.equal(buildSnapshot(input({ more: true })).more, true, 'more');
    const m = mergeInfo({ kind: 'merge', theirs: 'feat', hash: 'h', message: 'msg' }, 2, 'in');
    const s = buildSnapshot(input({ staged: [item('a')], merge: m }));
    assert.equal(s.type, 'data', 'type');
    assert.equal(s.currentBranch, 'main', 'branch');
    assert.equal(s.head, 'c2', 'head');
    assert.deepEqual(s.staged, [item('a')], 'lists');
    assert.deepEqual(s.merge, { kind: 'merge', theirs: 'feat', hash: 'h', message: 'msg', conflicts: 2 }, 'merge');
  });

  test('with changes the pseudo commit sits above HEAD', () => {
    const s = buildSnapshot(input({ unstaged: [item('a'), item('b')] }));
    const [wt, ...rest] = s.commits;
    assert.equal(wt.hash, WORKTREE);
    assert.deepEqual(wt.parents, ['c2']);
    assert.equal(wt.subject, 'Lokale Änderungen (2)');
    assert.equal(wt.date, 1000);
    assert.deepEqual(rest.map(c => c.hash), ['c2', 'c1']);
    assert.equal(s.rows.length, s.commits.length);
  });

  test('without HEAD (empty repo) there is no row, even with changes', () => {
    const s = buildSnapshot(input({ commits: [], head: undefined, unstaged: [item('a')] }));
    assert.deepEqual(s.commits, []);
    assert.equal(s.changeCount, 1);
  });

  test('partially staged files count once', () => {
    const s = buildSnapshot(input({ staged: [item('a'), item('b')], unstaged: [item('b'), item('c')] }));
    assert.equal(s.changeCount, 3);
    assert.equal(s.commits[0].subject, 'Lokale Änderungen (3)');
  });

  test('wide graphs are capped to the visible lanes, maxWidth stays the real width', () => {
    const n = GRAPH_MAX_LANES + 6;
    const parents = Array.from({ length: n }, (_, i) => `p${i}`);
    const commits = [commit('m', parents), ...parents.map(p => commit(p))];
    const s = buildSnapshot(input({ commits, head: 'm' }));
    assert.ok(s.maxWidth > GRAPH_MAX_LANES, `maxWidth ${s.maxWidth}`);
    for (const row of s.rows) for (const seg of row.segments) {
      assert.ok(Math.min(seg.x1, seg.x2) < GRAPH_MAX_LANES, 'segment beyond the visible lanes was sent');
    }
  });

  test('stashes appear as a row directly above their base commit (real repo)', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    const base = r.commitFile('b.txt', 'b\n');
    r.write('a.txt', 'x\n');
    r.stash('wip');
    const refs = await r.svc.refs();
    const s = buildSnapshot(input({ commits: await r.svc.log(10), refs, head: base }));
    const stash = refs.find(x => x.kind === 'stash')!;
    const i = s.commits.findIndex(c => c.hash === stash.hash);
    assert.ok(i >= 0, 'stash missing from the graph');
    assert.equal(s.commits[i + 1].hash, base);
    assert.equal(s.rows.length, s.commits.length);
  });
});

describe('mergeInfo', () => {
  test('nothing without an operation or conflicts; conflicts alone get their own kind; a running operation wins', () => {
    assert.equal(mergeInfo(undefined, 0, 'in'), undefined, 'nothing');
    assert.equal(mergeInfo({ kind: 'merge', theirs: 't', hash: 'h', message: 'm' }, 0, 'in')?.conflicts, 0, 'a merge has a conflict count');
    assert.deepEqual(mergeInfo(undefined, 3, 'Incoming'), { kind: 'conflicts', theirs: 'Incoming', hash: '', message: '', conflicts: 3 }, 'stash apply');
    assert.equal(mergeInfo({ kind: 'cherryPick', theirs: 't', hash: 'h', message: '' }, 1, 'in')?.kind, 'cherryPick', 'operation wins');
  });
});

describe('snapshotSignature', () => {
  type Args = Parameters<typeof snapshotSignature>;
  const base = (): Args => ['k', 'main', [item('a')], [item('b')], undefined];
  const sig = (...a: Args) => snapshotSignature(...a);

  test('same inputs, same fingerprint; any change to what is displayed changes it', () => {
    assert.equal(sig(...base()), sig(...base()), 'same inputs');
    const [k, b, s, u, m] = base();
    const ref = sig(...base());
    assert.notEqual(sig('k2', b, s, u, m), ref, 'log key');
    assert.notEqual(sig(k, 'dev', s, u, m), ref, 'branch');
    assert.notEqual(sig(k, b, [item('a', 'A')], u, m), ref, 'status of a staged file');
    assert.notEqual(sig(k, b, s, [], m), ref, 'unstaged list');
    assert.notEqual(sig(k, b, s, u, mergeInfo({ kind: 'merge', theirs: 't', hash: 'h', message: 'm' }, 1, 'in')), ref, 'merge starts');
    const m1 = mergeInfo({ kind: 'merge', theirs: 't', hash: 'h', message: 'm' }, 1, 'in'), m2 = mergeInfo({ kind: 'merge', theirs: 't', hash: 'h', message: 'm' }, 0, 'in');
    assert.notEqual(sig(k, b, s, u, m1), sig(k, b, s, u, m2), 'conflict count');
  });
});

describe('wiring', () => {
  test('main.js and the host use the same pseudo hash for "Local changes"', () => {
    assert.equal(require('../../media/nav.js').WORKTREE, WORKTREE, 'WORKTREE in media/nav.js differs from src/snapshot.ts');
  });
});
