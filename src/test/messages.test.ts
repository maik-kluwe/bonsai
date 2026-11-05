import { afterEach, beforeEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { FlowHarness } from './flowHarness';
import { lines } from './helpers';
import { hunkBody, parseDiff } from '../diff';
import { READ_ONLY_TYPES, VIEW_TYPES, handleRepoMessage, isRepoMessage, repoHandlers, type RepoType } from '../messages';
import { TO_HOST_TYPES, type ToHost } from '../protocol';
import { describeAction } from '../activityLog';
import { t } from '../i18n';

describe('message table', () => {
  test('every ToHost type is handled by the panel (VIEW_TYPES) or by repoHandlers, never by both', () => {
    const repoTypes = Object.keys(repoHandlers);
    assert.deepEqual(repoTypes.filter(x => (VIEW_TYPES as readonly string[]).includes(x)), []);
    assert.deepEqual([...repoTypes, ...VIEW_TYPES].sort(), [...TO_HOST_TYPES].sort());
  });
});

describe('stashing files', () => {
  test('the lists are up to date as soon as it is done', async () => {
    const h = new FlowHarness();
    try {
      h.t.commitFile('f.txt', 'old');
      h.t.write('f.txt', 'new');
      await h.repo.status();
      assert.equal(h.repo.state.workingTreeChanges.length, 1);
      await handleRepoMessage({ type: 'stashFiles', paths: ['f.txt'], message: 'wip' }, h.ctx);
      assert.equal(h.repo.state.workingTreeChanges.length, 0);
    } finally { h.dispose(); }
  });
});

describe('a snapshot', () => {
  test('leaves the lists as they were, without waiting for the file watcher', async () => {
    const h = new FlowHarness();
    try {
      h.t.commitFile('f.txt', 'old');
      h.t.write('f.txt', 'new');
      await h.repo.status();
      h.ui.inputAnswer = 'snap';
      await handleRepoMessage({ type: 'action', action: 'snapshot' }, h.ctx);
      assert.equal(h.repo.state.workingTreeChanges.length, 1);
    } finally { h.dispose(); }
  });
});

describe('hunks and lines', () => {
  let h: FlowHarness;
  beforeEach(() => {
    h = new FlowHarness();
    h.t.commitFile('f.txt', lines(30));
    // two separate hunks: line 2 and line 29
    h.t.write('f.txt', lines(30).replace('\n2\n', '\n2x\n').replace('\n29\n', '\n29x\n'));
  });
  afterEach(() => h.dispose());

  /** The hunk as the view has it on screen right now. */
  const shown = async (staged: boolean, index: number, context: number) =>
    hunkBody(parseDiff(await h.ctx.svc.diffLocal('f.txt', staged, false, context)).hunks[index]);

  test('hunk indices count in the context the view showed: with the whole file the two changes are one hunk', async () => {
    await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 0, action: 'stage', context: 100000, expect: await shown(false, 0, 100000) }, h.ctx);
    const staged = h.t.git('diff', '--cached');
    assert.match(staged, /\+2x/);
    assert.match(staged, /\+29x/);
  });

  test('without context lines the second hunk is still the second change, and lines are counted in that diff', async () => {
    await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 1, action: 'stage', context: 0, expect: await shown(false, 1, 0) }, h.ctx);
    const staged = h.t.git('diff', '--cached');
    assert.match(staged, /\+29x/);
    assert.doesNotMatch(staged, /\+2x/);
    // zero context: hunk 0 is '-2', '+2x' (index 1 is the removal)
    await handleRepoMessage({ type: 'lines', path: 'f.txt', staged: false, hunk: 0, lines: [1, 0], action: 'stage', context: 0, expect: await shown(false, 0, 0) }, h.ctx);
    assert.match(h.t.git('diff', '--cached'), /\+2x/);
  });

  test('unstaging it takes it out again', async () => {
    h.t.git('add', 'f.txt');
    await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: true, index: 0, action: 'unstage', context: 3, expect: await shown(true, 0, 3) }, h.ctx);
    const staged = h.t.git('diff', '--cached');
    assert.doesNotMatch(staged, /\+2x/);
    assert.match(staged, /\+29x/);
  });

  test('discarding asks first; no leaves the file alone, yes reverts only that hunk', async () => {
    h.ui.confirmAnswer = false;
    await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 0, action: 'discard', context: 3, expect: await shown(false, 0, 3) }, h.ctx);
    assert.deepEqual(h.ui.asked, [`confirm: ${t('confirmDiscardHunk')}`]);
    assert.match(h.t.git('diff'), /\+2x/);

    h.ui.confirmAnswer = true;
    await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 0, action: 'discard', context: 3, expect: await shown(false, 0, 3) }, h.ctx);
    const diff = h.t.git('diff');
    assert.doesNotMatch(diff, /\+2x/);
    assert.match(diff, /\+29x/);
  });

  describe('the lists follow without a refresh', () => {
    test('discarding the last hunk takes the file off the list', async () => {
      await h.repo.status();
      await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 1, action: 'discard', context: 3, expect: await shown(false, 1, 3) }, h.ctx);
      assert.equal(h.repo.state.workingTreeChanges.length, 1);
      await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 0, action: 'discard', context: 3, expect: await shown(false, 0, 3) }, h.ctx);
      assert.equal(h.repo.state.workingTreeChanges.length, 0);
    });

    test('so does discarding the last lines', async () => {
      h.t.write('f.txt', lines(30).replace('\n2\n', '\n2x\n'));
      await h.repo.status();
      await handleRepoMessage({ type: 'lines', path: 'f.txt', staged: false, hunk: 0, lines: [0, 1], action: 'discard', context: 0, expect: await shown(false, 0, 0) }, h.ctx);
      assert.equal(h.repo.state.workingTreeChanges.length, 0);
    });
  });

  describe('the diff changed after it was drawn', () => {
    beforeEach(() => {
      // three hunks: lines 2, 15 and 29
      h.t.write('f.txt', lines(30).replace('\n2\n', '\n2x\n').replace('\n15\n', '\n15x\n').replace('\n29\n', '\n29x\n'));
    });

    /** The view drew hunk 1 (line 15), then that hunk was staged: position 1 is now line 29. */
    const staleMiddleHunk = async () => {
      const expect = await shown(false, 1, 3);
      await handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 1, action: 'stage', context: 3, expect }, h.ctx);
      return expect;
    };

    test('staging by the old position does not take the hunk that moved there', async () => {
      const expect = await staleMiddleHunk();
      await assert.rejects(handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 1, action: 'stage', context: 3, expect }, h.ctx), /the diff has changed/);
      assert.doesNotMatch(h.t.git('diff', '--cached'), /29x/);
    });

    test('discarding by the old position is refused before it asks', async () => {
      const expect = await staleMiddleHunk();
      await assert.rejects(handleRepoMessage({ type: 'hunk', path: 'f.txt', staged: false, index: 1, action: 'discard', context: 3, expect }, h.ctx), /the diff has changed/);
      assert.deepEqual(h.ui.asked, []);
      assert.match(h.t.git('diff'), /\+29x/);
    });

    test('single lines by the old position are refused as well', async () => {
      const expect = await staleMiddleHunk();
      await assert.rejects(handleRepoMessage({ type: 'lines', path: 'f.txt', staged: false, hunk: 1, lines: [4], action: 'discard', context: 3, expect }, h.ctx), /the diff has changed/);
      assert.match(h.t.git('diff'), /\+29x/);
    });
  });

  test('staging single lines recounts the hunk', async () => {
    h.t.write('f.txt', lines(30).replace('\n2\n', '\n2x\n2y\n'));
    // hunk lines: ' 1', '-2', '+2x', '+2y', ' 3' … index 2 is "+2x"
    await handleRepoMessage({ type: 'lines', path: 'f.txt', staged: false, hunk: 0, lines: [2], action: 'stage', context: 3, expect: await shown(false, 0, 3) }, h.ctx);
    const staged = h.t.git('diff', '--cached');
    assert.match(staged, /\+2x/);
    assert.doesNotMatch(staged, /\+2y/);
  });
});

describe('files', () => {
  let h: FlowHarness;
  beforeEach(() => { h = new FlowHarness(); h.t.commitFile('a.txt', 'a\n'); });
  afterEach(() => h.dispose());

  test('stage and unstage go through the Git API wrapper', async () => {
    h.t.write('a.txt', 'changed\n');
    await handleRepoMessage({ type: 'stage', paths: ['a.txt'] }, h.ctx);
    assert.deepEqual(h.t.status(), ['M  a.txt']);
    await handleRepoMessage({ type: 'unstage', paths: ['a.txt'] }, h.ctx);
    assert.deepEqual(h.t.status(), [' M a.txt']);
    assert.equal(h.apiCalls, 2);
  });

  test('discard names a single file, counts several, and does nothing when declined', async () => {
    h.t.write('a.txt', 'changed\n');
    h.ui.confirmAnswer = false;
    await handleRepoMessage({ type: 'discard', paths: ['a.txt'] }, h.ctx);
    assert.deepEqual(h.ui.asked, [`confirm: ${t('confirmDiscardFiles', '"a.txt"')}`]);
    assert.deepEqual(h.t.status(), [' M a.txt']);

    h.ui.asked = [];
    h.ui.confirmAnswer = true;
    await handleRepoMessage({ type: 'discard', paths: ['a.txt', 'b.txt'] }, h.ctx);
    assert.deepEqual(h.ui.asked, [`confirm: ${t('confirmDiscardFiles', t('nFiles', 2))}`]);
    assert.deepEqual(h.t.status(), []);
  });
});

describe('commit', () => {
  let h: FlowHarness;
  beforeEach(() => { h = new FlowHarness(); h.t.commitFile('a.txt', 'a\n'); });
  afterEach(() => h.dispose());

  test('refuses without a message, without staged changes, and says so in the language of the UI', async () => {
    await assert.rejects(handleRepoMessage({ type: 'commit', message: '  ', amend: false }, h.ctx), { message: t('errNoMessage') });
    await assert.rejects(handleRepoMessage({ type: 'commit', message: 'm', amend: false }, h.ctx), { message: t('errNothingStaged') });
    assert.deepEqual(h.posted, []);
  });

  test('commits what is staged and tells the webview', async () => {
    h.t.write('a.txt', 'b\n');
    h.t.git('add', 'a.txt');
    await h.repo.status();
    await handleRepoMessage({ type: 'commit', message: 'second', amend: false }, h.ctx);
    assert.equal(h.t.git('log', '-1', '--format=%s').trim(), 'second');
    assert.deepEqual(h.posted, [{ type: 'committed' }]);
  });

  test('open conflicts block it, with a merge marker and without one (stash apply)', async () => {
    h.t.git('checkout', '-q', '-b', 'feat');
    h.t.commitFile('a.txt', 'feat\n');
    h.t.git('checkout', '-q', 'main');
    h.t.commitFile('a.txt', 'main\n');
    h.t.tryGit('merge', 'feat');
    await h.repo.status();
    await assert.rejects(handleRepoMessage({ type: 'commit', message: 'm', amend: false }, h.ctx), { message: t('errConflicts') });

    h.t.git('merge', '--abort');
    h.t.write('a.txt', 'dirty\n');
    h.t.stash('s');
    h.t.commitFile('a.txt', 'other\n');
    h.t.tryGit('stash', 'apply');
    await h.repo.status();
    assert.equal(h.t.tryGit('rev-parse', '-q', '--verify', 'MERGE_HEAD').code, 1);
    await assert.rejects(handleRepoMessage({ type: 'commit', message: 'm', amend: false }, h.ctx), { message: t('errConflicts') });
  });
});

describe('abort and rebase skip', () => {
  let h: FlowHarness;
  beforeEach(() => {
    h = new FlowHarness();
    h.t.commitFile('a.txt', 'a\n');
    h.t.git('checkout', '-q', '-b', 'feat');
    h.t.commitFile('a.txt', 'feat\n');
    h.t.git('checkout', '-q', 'main');
    h.t.commitFile('a.txt', 'main\n');
  });
  afterEach(() => h.dispose());

  test('abort asks the question that fits the running operation, and restores the state on yes', async () => {
    h.t.tryGit('merge', 'feat');
    await h.repo.status();
    h.ui.confirmAnswer = false;
    await handleRepoMessage({ type: 'mergeAbort' }, h.ctx);
    assert.deepEqual(h.ui.asked, [`confirm: ${t('confirmAbortMerge')}`]);
    assert.equal(h.t.tryGit('rev-parse', '-q', '--verify', 'MERGE_HEAD').code, 0);

    h.ui.confirmAnswer = true;
    await handleRepoMessage({ type: 'mergeAbort' }, h.ctx);
    assert.equal(h.t.tryGit('rev-parse', '-q', '--verify', 'MERGE_HEAD').code, 1);
    assert.deepEqual(h.t.status(), []);
  });

  test('with nothing running and nothing conflicted, abort asks nothing', async () => {
    await handleRepoMessage({ type: 'mergeAbort' }, h.ctx);
    assert.deepEqual(h.ui.asked, []);
  });

  test('skipping a rebase commit is confirmed first', async () => {
    h.t.git('checkout', '-q', 'feat');
    h.t.tryGit('rebase', 'main');
    h.ui.confirmAnswer = false;
    await handleRepoMessage({ type: 'rebaseSkip' }, h.ctx);
    assert.deepEqual(h.ui.asked, [`confirm: ${t('confirmRebaseSkip')}`]);
    assert.ok(h.t.tryGit('rev-parse', '-q', '--verify', 'REBASE_HEAD').code === 0, 'rebase still stopped');
  });

  test('continuing is refused while conflicts are open', async () => {
    h.t.git('checkout', '-q', 'feat');
    h.t.tryGit('rebase', 'main');
    await h.repo.status();
    await assert.rejects(handleRepoMessage({ type: 'rebaseContinue' }, h.ctx), { message: t('errConflicts') });
  });
});

describe('merge, cherry-pick, reset, stash', () => {
  let h: FlowHarness;
  beforeEach(() => {
    h = new FlowHarness();
    h.t.commitFile('a.txt', 'a\n');
    h.t.git('checkout', '-q', '-b', 'feat');
    h.t.commitFile('a.txt', 'feat\n');
    h.t.git('checkout', '-q', 'main');
  });
  afterEach(() => h.dispose());

  test('a clean merge offers all four options and runs the one picked', async () => {
    h.t.commitFile('b.txt', 'b\n');
    h.ui.pickAnswer = items => items[0];
    await handleRepoMessage({ type: 'merge', ref: 'feat' }, h.ctx);
    assert.equal(h.ui.offered.length, 4);
    assert.equal(h.t.git('log', '-1', '--format=%p').trim().split(' ').length, 2, 'merge commit');
    assert.deepEqual(h.ui.informed, []);
  });

  test('a conflicting merge withholds squash, starts anyway and shows what Git printed', async () => {
    h.t.commitFile('a.txt', 'main\n');
    await handleRepoMessage({ type: 'merge', ref: 'feat' }, h.ctx);
    assert.equal(h.ui.offered.length, 3);
    assert.ok(!h.ui.offered.includes(t('mergeOptSquash')));
    assert.equal(h.ui.informed.length, 1);
    assert.match(h.ui.informed[0].detail, /CONFLICT/);
    assert.equal(h.t.tryGit('rev-parse', '-q', '--verify', 'MERGE_HEAD').code, 0);
  });

  test('cancelling the dialog leaves the repository alone', async () => {
    h.ui.pickAnswer = () => undefined;
    await handleRepoMessage({ type: 'merge', ref: 'feat' }, h.ctx);
    assert.equal(h.t.git('log', '-1', '--format=%s').trim(), 'edit a.txt');
    assert.deepEqual(h.t.status(), []);
  });

  test('cherry-pick without committing is refused when conflicts are expected', async () => {
    h.t.commitFile('a.txt', 'main\n');
    const hash = h.t.git('rev-parse', 'feat').trim();
    h.ui.pickManyAnswer = () => [];
    await handleRepoMessage({ type: 'cherryPick', hash }, h.ctx);
    assert.equal(h.ui.errors.length, 1);
    assert.deepEqual(h.t.status(), []);
  });

  test('hard reset only asks when tracked changes would be lost', async () => {
    h.ui.pickAnswer = items => items.find(i => i.detail === '--hard');
    const target = h.t.git('rev-parse', 'HEAD').trim();
    h.t.write('untracked.txt', 'x\n');
    await h.repo.status();
    await handleRepoMessage({ type: 'reset', hash: target }, h.ctx);
    assert.ok(!h.ui.asked.some(q => q.startsWith('confirm')), 'untracked files alone do not need a confirmation');

    h.t.write('a.txt', 'dirty\n');
    await h.repo.status();
    h.ui.confirmAnswer = false;
    await handleRepoMessage({ type: 'reset', hash: target }, h.ctx);
    assert.ok(h.ui.asked.some(q => q.startsWith('confirm')));
    assert.deepEqual(h.t.status().sort(), [' M a.txt', '?? untracked.txt']);
  });

  test('applying a stash keeps it unless the box is ticked, and always keeps it on conflicts', async () => {
    h.t.write('b.txt', 'stashed\n');
    h.t.git('add', 'b.txt');
    h.t.stash('work');
    const entry = { type: 'stashAction' as const, action: 'apply' as const, index: 0, name: 'On main: work' };

    await handleRepoMessage(entry, h.ctx);
    assert.equal(h.t.git('stash', 'list').trim().split('\n').length, 1, 'kept');
    h.t.git('reset', '-q', '--hard');
    h.t.git('clean', '-fdq');

    h.ui.pickManyAnswer = items => items;
    await handleRepoMessage(entry, h.ctx);
    assert.equal(h.t.git('stash', 'list').trim(), '', 'dropped after a clean apply');

    h.t.git('reset', '-q', '--hard');
    h.t.write('a.txt', 'stashed\n');
    h.t.stash('conflicting');
    h.t.commitFile('a.txt', 'other\n');
    await handleRepoMessage(entry, h.ctx);
    assert.equal(h.t.git('stash', 'list').trim().split('\n').length, 1, 'kept although the box was ticked');
    assert.equal(h.ui.informed.length, 1);
  });

  test('the view hears of a new branch, and not of a cancelled one', async () => {
    const created = () => h.posted.filter(m => m.type === 'branchCreated');
    h.ui.inputAnswer = undefined;
    await handleRepoMessage({ type: 'action', action: 'branch' }, h.ctx);
    await handleRepoMessage({ type: 'createBranchAt', hash: h.t.git('rev-parse', 'HEAD').trim() }, h.ctx);
    assert.deepEqual(created(), []);

    h.ui.inputAnswer = 'group/one';
    await handleRepoMessage({ type: 'action', action: 'branch' }, h.ctx);
    h.ui.inputAnswer = 'group/two';
    await handleRepoMessage({ type: 'createBranchAt', hash: h.t.git('rev-parse', 'HEAD').trim() }, h.ctx);
    assert.deepEqual(created(), [{ type: 'branchCreated', name: 'group/one' }, { type: 'branchCreated', name: 'group/two' }]);
  });
});

describe('read-only messages answer the webview', () => {
  let h: FlowHarness;
  beforeEach(() => { h = new FlowHarness(); h.t.commitFile('a.txt', 'a\n', 'first'); });
  afterEach(() => h.dispose());

  test('details, lastMessage and recentMessages', async () => {
    const hash = h.t.git('rev-parse', 'HEAD').trim();
    await handleRepoMessage({ type: 'details', hash }, h.ctx);
    await handleRepoMessage({ type: 'lastMessage' }, h.ctx);
    await handleRepoMessage({ type: 'recentMessages' }, h.ctx);
    assert.deepEqual(h.posted.map(p => p.type), ['details', 'lastMessage', 'recentMessages']);
    assert.deepEqual(h.posted[1], { type: 'lastMessage', message: 'first' });
  });

  test('fileDiff passes the number of context lines on and names it in the answer', async () => {
    const first = h.t.commitFile('c.txt', '1\n2\n3\n4\n5\n6\n7\n8\n9\n');
    const second = h.t.commitFile('c.txt', '1\n2\n3\n4\nfive\n6\n7\n8\n9\n');
    await handleRepoMessage({ type: 'fileDiff', hash: second, parent: first, path: 'c.txt', context: 1 }, h.ctx);
    await handleRepoMessage({ type: 'fileDiff', hash: second, parent: first, path: 'c.txt', context: 100000 }, h.ctx);
    const [few, all] = h.posted as { context?: number; hunks: { lines: unknown[] }[] }[];
    assert.equal(few.context, 1);
    assert.equal(few.hunks[0].lines.length, 4, 'one line either side of the change');
    assert.equal(all.context, 100000);
    assert.equal(all.hunks[0].lines.length, 10, 'the whole file');
  });

  test('fileDiff with ignoreSpace leaves out changes of whitespace only', async () => {
    const first = h.t.commitFile('w.txt', 'a b\n');
    const second = h.t.commitFile('w.txt', 'a   b\n');
    await handleRepoMessage({ type: 'fileDiff', hash: second, parent: first, path: 'w.txt' }, h.ctx);
    await handleRepoMessage({ type: 'fileDiff', hash: second, parent: first, path: 'w.txt', ignoreSpace: true }, h.ctx);
    const [plain, ignored] = h.posted as { ignoreSpace?: boolean; hunks: unknown[] }[];
    assert.equal(plain.hunks.length, 1);
    assert.equal(ignored.hunks.length, 0);
    assert.equal(ignored.ignoreSpace, true);
  });
});

describe('read-only messages', () => {
  test('every one has a handler, and none of them is logged as an action', () => {
    for (const type of READ_ONLY_TYPES) {
      assert.ok(isRepoMessage({ type } as ToHost), `${type} has no handler`);
      assert.equal(describeAction({ type } as ToHost), undefined, `${type} only reads but is logged`);
    }
  });
});
