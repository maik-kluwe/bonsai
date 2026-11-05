import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { existsSync } from 'fs';
import * as path from 'path';
import { MERGE_OPTIONS } from '../operations';
import { TestRepo } from './helpers';

const repos: TestRepo[] = [];
const create = () => { const r = new TestRepo(); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

/**
 * main: base -> m1 (edits a.txt)
 * clean: base -> c1 (adds c.txt)       does not touch a.txt
 * clash: base -> k1 (edits a.txt too)  conflicts with m1
 * HEAD is on main.
 */
function scenario(r: TestRepo) {
  r.commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
  r.git('branch', 'clean');
  r.git('branch', 'clash');
  const m1 = r.commitFile('a.txt', 'one\nMAIN\nthree\n', 'm1');
  r.git('checkout', '-q', 'clean');
  const c1 = r.commitFile('c.txt', 'c\n', 'c1');
  r.git('checkout', '-q', 'clash');
  const k1 = r.commitFile('a.txt', 'one\nCLASH\nthree\n', 'k1');
  r.git('checkout', '-q', 'main');
  return { m1, c1, k1 };
}

/** edit1 adds "two", edit2 changes that line: reverting edit1 conflicts. */
function revertScenario(r: TestRepo) {
  r.commitFile('a.txt', 'one\n', 'base');
  const edit1 = r.commitFile('a.txt', 'one\ntwo\n', 'edit1');
  const edit2 = r.commitFile('a.txt', 'one\ntwo CHANGED\n', 'edit2');
  return { edit1, edit2 };
}

const head = (r: TestRepo) => r.git('rev-parse', 'HEAD').trim();
const mergeHeadExists = (r: TestRepo) => r.tryGit('rev-parse', '-q', '--verify', 'MERGE_HEAD').code === 0;

describe('preview', () => {
  test('merge: clean branch has no conflicts, clashing branch names the file', async () => {
    const r = create();
    scenario(r);
    assert.deepEqual(await r.svc.preview('merge', 'clean'), []);
    assert.deepEqual(await r.svc.preview('merge', 'clash'), ['a.txt']);
  });

  test('cherry-pick: a commit that only adds a file is clean, one that edits the same lines conflicts', async () => {
    const r = create();
    const { c1, k1 } = scenario(r);
    assert.deepEqual(await r.svc.preview('cherryPick', c1), []);
    assert.deepEqual(await r.svc.preview('cherryPick', k1), ['a.txt']);
  });

  test('revert: reverting an old, independent commit is clean; reverting one that later lines build on conflicts', async () => {
    const r = create();
    r.commitFile('a.txt', 'one\n', 'base');
    const edit1 = r.commitFile('a.txt', 'one\ntwo\n', 'edit1');
    r.commitFile('a.txt', 'one\ntwo CHANGED\n', 'edit2');
    assert.deepEqual(await r.svc.preview('revert', edit1), ['a.txt']);
    const adds = r.commitFile('b.txt', 'b\n', 'adds b');
    assert.deepEqual(await r.svc.preview('revert', adds), []);
  });
});

describe('merge', () => {
  test('each option does what it says, and all of them accept a clean branch', async () => {
    const ahead = (file: string) => {
      const r = create();
      r.commitFile('a.txt', 'a\n', 'base');
      r.git('checkout', '-q', '-b', 'ahead');
      const tip = r.commitFile(file, 'b\n', 'ahead');
      r.git('checkout', '-q', 'main');
      return { r, tip };
    };

    const ff = ahead('a.txt');
    assert.deepEqual(await ff.r.svc.merge('ahead', 'default'), { conflicted: false }, 'default');
    assert.equal(head(ff.r), ff.tip, 'default fast-forwards when possible');

    const noFf = ahead('b.txt');
    await noFf.r.svc.merge('ahead', 'noFf');
    assert.equal(noFf.r.git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'noFf: a merge commit with two parents');

    const squash = create();
    const squashed = scenario(squash);
    await squash.svc.merge('clean', 'squash');
    assert.equal(head(squash), squashed.m1, 'squash: no commit');
    assert.deepEqual(squash.status(), ['A  c.txt'], 'squash: the changes are staged');
    assert.equal(mergeHeadExists(squash), false, 'squash: no MERGE_HEAD');

    const noCommit = create();
    const open = scenario(noCommit);
    await noCommit.svc.merge('clean', 'noCommit');
    assert.equal(head(noCommit), open.m1, 'noCommit: no commit');
    assert.equal(mergeHeadExists(noCommit), true, 'noCommit: the merge stays open');
    assert.ok((await noCommit.svc.mergeState()) !== undefined, 'noCommit: the merge is shown');

    for (const option of MERGE_OPTIONS) {
      const r = create();
      scenario(r);
      assert.deepEqual(await r.svc.merge('clean', option), { conflicted: false }, option);
    }
  });

  test('a conflict is a result, not an exception, and MERGE_HEAD stays for the banner', async () => {
    const r = create();
    scenario(r);
    assert.equal((await r.svc.merge('clash', 'default')).conflicted, true);
    assert.equal(mergeHeadExists(r), true);
    assert.deepEqual(r.status(), ['UU a.txt']);
  });

  test('a real error (unknown ref) is still thrown', async () => {
    const r = create();
    scenario(r);
    await assert.rejects(r.svc.merge('does-not-exist', 'default'), /not something we can merge|does-not-exist/);
  });
});

describe('cherryPick and revert', () => {
  test('commit, without commit, and the origin line', async () => {
    const picked = create();
    const c = scenario(picked);
    await picked.svc.cherryPick(c.c1, { commit: true, appendOrigin: false });
    assert.equal(picked.git('log', '-1', '--format=%s').trim(), 'c1', 'cherry-pick keeps the original message');
    assert.deepEqual(picked.status(), [], 'cherry-pick commits');

    const staged = create();
    const n = scenario(staged);
    await staged.svc.cherryPick(n.c1, { commit: false, appendOrigin: false });
    assert.equal(head(staged), n.m1, 'cherry-pick without commit: no commit');
    assert.deepEqual(staged.status(), ['A  c.txt'], 'cherry-pick without commit: staged only');

    const origin = create();
    const o = scenario(origin);
    await origin.svc.cherryPick(o.c1, { commit: true, appendOrigin: true });
    assert.match(origin.git('log', '-1', '--format=%B'), new RegExp(`cherry picked from commit ${o.c1}`), 'appendOrigin');

    const addsB = (r: TestRepo) => { r.commitFile('a.txt', 'a\n', 'base'); return r.commitFile('b.txt', 'b\n', 'adds b'); };
    const reverted = create();
    await reverted.svc.revert(addsB(reverted), { commit: true });
    assert.equal(reverted.git('log', '-1', '--format=%s').trim(), 'Revert "adds b"', 'revert adds a Revert commit');
    assert.deepEqual(reverted.status(), [], 'revert undoes the change');

    const unstaged = create();
    const adds = addsB(unstaged);
    await unstaged.svc.revert(adds, { commit: false });
    assert.equal(head(unstaged), adds, 'revert without commit: no commit');
    assert.deepEqual(unstaged.status(), ['D  b.txt'], 'revert without commit: the reverse change is staged');
  });
});

describe('conflicting cherry-pick and revert', () => {
  const markerExists = (r: TestRepo, marker: string) => r.tryGit('rev-parse', '-q', '--verify', marker).code === 0;

  test('cherry-pick: a conflict is a result, CHERRY_PICK_HEAD names the picked commit', async () => {
    const r = create();
    const { k1 } = scenario(r);
    assert.equal((await r.svc.cherryPick(k1, { commit: true, appendOrigin: false })).conflicted, true);
    assert.deepEqual(r.status(), ['UU a.txt']);
    const s = (await r.svc.mergeState())!;
    assert.equal(s.kind, 'cherryPick');
    assert.equal(s.hash, k1);
    assert.equal(s.theirs, k1.slice(0, 7));
    assert.equal(s.message.split('\n')[0], 'k1');
    assert.ok(!s.message.split('\n').some(l => l.startsWith('#')), 'git comment lines are dropped');
  });

  test('without committing a cherry-pick leaves no marker, which is why it is refused with conflicts; a revert keeps REVERT_HEAD', async () => {
    const r = create();
    const { k1 } = scenario(r);
    assert.equal((await r.svc.cherryPick(k1, { commit: false, appendOrigin: false })).conflicted, true, 'cherry-pick');
    assert.equal(markerExists(r, 'CHERRY_PICK_HEAD'), false, 'cherry-pick');
    assert.equal(await r.svc.mergeState(), undefined, 'cherry-pick');

    const v = create();
    const { edit1, edit2 } = revertScenario(v);
    assert.equal((await v.svc.revert(edit1, { commit: false })).conflicted, true, 'revert');
    assert.equal((await v.svc.mergeState())!.kind, 'revert', 'revert');
    await v.svc.abort('revert');
    assert.equal(head(v), edit2, 'revert');
    assert.deepEqual(v.status(), [], 'revert');
  });

  test('revert: a conflict is a result, REVERT_HEAD names the reverted commit', async () => {
    const r = create();
    const { edit1 } = revertScenario(r);
    assert.equal((await r.svc.revert(edit1, { commit: true })).conflicted, true);
    const s = (await r.svc.mergeState())!;
    assert.equal(s.kind, 'revert');
    assert.equal(s.hash, edit1);
    assert.match(s.message, /^Revert "edit1"/);
  });

  test('conflictSides names the picked commit as the theirs side', async () => {
    const r = create();
    const { k1 } = scenario(r);
    await r.svc.cherryPick(k1, { commit: true, appendOrigin: false });
    const sides = await r.svc.conflictSides('a.txt', (await r.svc.mergeState())!.hash);
    assert.equal(sides.theirs.subject, 'k1');
    assert.equal(sides.ours.subject, 'm1');
  });
});

describe('reset', () => {
  /** base -> two (a.txt changed, b.txt added); HEAD at two with an extra unstaged edit. */
  function history(r: TestRepo) {
    const base = r.commitFile('a.txt', 'one\n', 'base');
    r.commitFile('a.txt', 'one\ntwo\n', 'two');
    r.commitFile('b.txt', 'b\n', 'adds b');
    return base;
  }

  test('HEAD moves; the undone changes stay staged (soft), unstaged (mixed) or go (hard)', async () => {
    for (const [mode, want] of [['soft', ['A  b.txt', 'M  a.txt']], ['mixed', [' M a.txt', '?? b.txt']], ['hard', []]] as const) {
      const r = create();
      const base = history(r);
      if (mode === 'hard') r.write('a.txt', 'edited\n');
      await r.svc.reset(base, mode);
      assert.equal(head(r), base, mode);
      assert.deepEqual(r.status().sort(), want, mode);
    }
  });
});

describe('rebase', () => {
  /**
   * main: base -> m1 (edits a.txt)
   * topic: base -> t1 (adds t.txt) -> t2 (edits a.txt: conflicts with m1)
   * HEAD on topic; rebasing it onto main stops at t2.
   */
  function topic(r: TestRepo) {
    r.commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
    r.git('checkout', '-q', '-b', 'topic');
    r.commitFile('t.txt', 't\n', 't1');
    const t2 = r.commitFile('a.txt', 'one\nTOPIC\nthree\n', 't2');
    r.git('checkout', '-q', 'main');
    r.commitFile('a.txt', 'one\nMAIN\nthree\n', 'm1');
    r.git('checkout', '-q', 'topic');
    return { t2, topicTip: head(r) };
  }
  const markerExists = (r: TestRepo) => r.tryGit('rev-parse', '-q', '--verify', 'REBASE_HEAD').code === 0;

  test('a clean rebase just finishes', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n', 'base');
    r.git('checkout', '-q', '-b', 'topic');
    r.commitFile('t.txt', 't\n', 't1');
    r.git('checkout', '-q', 'main');
    const m1 = r.commitFile('m.txt', 'm\n', 'm1');
    r.git('checkout', '-q', 'topic');
    assert.deepEqual(await r.svc.rebase('main', { autostash: false }), { conflicted: false });
    assert.equal(r.git('rev-parse', 'HEAD~1').trim(), m1);
    assert.equal(await r.svc.mergeState(), undefined);
    assert.equal(existsSync(path.join(r.dir, '.git', 'bonsai-rebase')), false, 'without autostash nothing is noted');
  });

  test('a conflict is a result; the state names the branch, the step and the commit being replayed', async () => {
    const r = create();
    const { t2 } = topic(r);
    assert.equal((await r.svc.rebase('main', { autostash: false })).conflicted, true);
    assert.equal(markerExists(r), true);
    const s = (await r.svc.mergeState())!;
    assert.equal(s.kind, 'rebase');
    assert.equal(s.hash, t2);
    assert.deepEqual(s.rebase, { branch: 'topic', step: 2, total: 2 });
    assert.equal(s.message, '');
  });

  test('conflictSides: ours is the branch rebased onto, theirs is the commit being replayed', async () => {
    const r = create();
    topic(r);
    await r.svc.rebase('main', { autostash: false });
    const sides = await r.svc.conflictSides('a.txt', (await r.svc.mergeState())!.hash);
    assert.equal(sides.ours.subject, 'm1');
    assert.equal(sides.theirs.subject, 't2');
  });

  test('abort restores the state before, whatever was running', async () => {
    const pick = create();
    const { m1, k1 } = scenario(pick);
    await pick.svc.cherryPick(k1, { commit: true, appendOrigin: false });
    await pick.svc.abort('cherryPick');
    assert.equal(await pick.svc.mergeState(), undefined, 'cherry-pick');
    assert.equal(head(pick), m1, 'cherry-pick');
    assert.deepEqual(pick.status(), [], 'cherry-pick');

    const rev = create();
    const { edit1, edit2 } = revertScenario(rev);
    await rev.svc.revert(edit1, { commit: true });
    await rev.svc.abort('revert');
    assert.equal(await rev.svc.mergeState(), undefined, 'revert');
    assert.equal(head(rev), edit2, 'revert');
    assert.deepEqual(rev.status(), [], 'revert');

    const base = create();
    const { topicTip } = topic(base);
    await base.svc.rebase('main', { autostash: false });
    await base.svc.abort('rebase');
    assert.equal(await base.svc.mergeState(), undefined, 'rebase');
    assert.equal(head(base), topicTip, 'rebase');
    assert.equal(base.git('branch', '--show-current').trim(), 'topic', 'rebase');
  });

  test('continue after resolving finishes the rebase without opening an editor', async () => {
    const r = create();
    topic(r);
    await r.svc.rebase('main', { autostash: false });
    r.write('a.txt', 'one\nRESOLVED\nthree\n');
    r.git('add', 'a.txt');
    assert.deepEqual(await r.svc.rebaseContinue(), { conflicted: false });
    assert.equal(await r.svc.mergeState(), undefined);
    assert.equal(r.git('log', '-1', '--format=%s').trim(), 't2');
    assert.equal(r.git('show', 'HEAD:a.txt'), 'one\nRESOLVED\nthree\n');
  });

  test('skip drops the conflicting commit', async () => {
    const r = create();
    topic(r);
    await r.svc.rebase('main', { autostash: false });
    assert.deepEqual(await r.svc.rebaseSkip(), { conflicted: false });
    assert.equal(await r.svc.mergeState(), undefined);
    assert.equal(r.git('log', '-1', '--format=%s').trim(), 't1');
    assert.equal(r.git('show', 'HEAD:a.txt'), 'one\nMAIN\nthree\n');
  });
});

describe('conflicts without a marker (stash apply)', () => {
  /** a.txt: the stash and main edit the same line. b.txt: only the stash edits it. */
  function conflictingStash(r: TestRepo) {
    r.commitFile('a.txt', 'one\ntwo\nthree\n', 'base a');
    r.commitFile('b.txt', 'one\ntwo\nthree\n', 'base b');
    r.write('a.txt', 'one\nSTASH\nthree\n');
    r.write('b.txt', 'one\ntwo\nSTASHB\n');
    r.git('stash', 'push', '-q', '-m', 's');
    r.commitFile('a.txt', 'one\nMAIN\nthree\n', 'main edits a');
  }

  test('discardAll removes the conflict and the cleanly applied part, but not the stash or untracked files', async () => {
    const r = create();
    conflictingStash(r);
    r.write('untracked.txt', 'u\n');
    r.tryGit('stash', 'apply');
    assert.equal(await r.svc.mergeState(), undefined, 'Git leaves no marker');
    await r.svc.discardAll();
    assert.deepEqual(r.status(), ['?? untracked.txt']);
    assert.match(r.git('stash', 'list'), /: s/);
  });
});

describe('applyStash', () => {
  test('a conflict is a result, not an exception; the stash stays', async () => {
    const r = create();
    r.commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
    r.write('a.txt', 'one\nSTASH\nthree\n');
    r.git('stash', 'push', '-q', '-m', 's');
    r.commitFile('a.txt', 'one\nMAIN\nthree\n', 'main edits');
    const o = await r.svc.applyStash(0);
    assert.equal(o.conflicted, true);
    assert.match(o.conflicted ? o.output : '', /a\.txt/, 'the output names the conflicting file');
    assert.deepEqual(r.status(), ['UU a.txt']);
    assert.match(r.git('stash', 'list'), /: s/);
  });
});

describe('conflictSides without a known commit', () => {
  test('after a stash apply the sides carry the kind of change but no commit', async () => {
    const r = create();
    r.commitFile('a.txt', 'one\ntwo\nthree\n', 'base');
    r.write('a.txt', 'one\nSTASH\nthree\n');
    r.git('stash', 'push', '-q', '-m', 's');
    r.commitFile('a.txt', 'one\nMAIN\nthree\n', 'main edits');
    await r.svc.applyStash(0);
    const sides = await r.svc.conflictSides('a.txt');
    assert.deepEqual(sides.theirs, { change: 'modified' });
    assert.equal(sides.ours.change, 'modified');
    assert.equal(sides.ours.subject, 'main edits');
  });
});
