import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { FlowHarness } from './flowHarness';
import { lines } from './helpers';
import { handleRepoMessage } from '../messages';
import type { FetchOptions } from '../git';
import type { PullInfo } from '../protocol';
import { PULL_CHOICE_KEY } from '../flows';

/**
 * A work repository with a server (a bare repository) and a second clone that plays the colleague who pushes. The
 * work repository starts on main with a.txt (30 lines) and b.txt, both pushed, so main tracks origin/main.
 *
 * Building that takes a dozen Git calls, which adds up over twenty tests, so it is done once and copied: the
 * repositories are small, and only the address of the server has to be told to the copies.
 */
let template: { work: string; server: string; colleague: string; dispose(): void } | undefined;

function buildTemplate() {
  const h = new FlowHarness();
  const server = mkdtempSync(path.join(tmpdir(), 'bonsai-server-'));
  const colleague = mkdtempSync(path.join(tmpdir(), 'bonsai-colleague-'));
  execFileSync('git', ['-C', server, 'init', '-q', '--bare', '-b', 'main']);
  h.t.git('remote', 'add', 'origin', server);
  h.t.write('a.txt', lines(30));
  h.t.write('b.txt', lines(30));
  h.t.commit('base');
  h.t.git('push', '-q', '-u', 'origin', 'main');
  execFileSync('git', ['clone', '-q', server, colleague], { stdio: 'ignore' });
  for (const [k, v] of [['user.email', 'colleague@example.com'], ['user.name', 'Colleague'], ['commit.gpgsign', 'false']]) {
    execFileSync('git', ['-C', colleague, 'config', k, v]);
  }
  return {
    work: h.t.dir, server, colleague,
    dispose() { h.dispose(); rmSync(server, { recursive: true, force: true }); rmSync(colleague, { recursive: true, force: true }); },
  };
}

after(() => template?.dispose());

class Setup {
  readonly h = new FlowHarness();
  readonly bare = mkdtempSync(path.join(tmpdir(), 'bonsai-server-'));
  readonly other = mkdtempSync(path.join(tmpdir(), 'bonsai-colleague-'));
  fetched: FetchOptions[] = [];

  constructor() {
    const { h } = this;
    template ??= buildTemplate();
    cpSync(template.work, h.t.dir, { recursive: true, force: true });
    cpSync(template.server, this.bare, { recursive: true, force: true });
    cpSync(template.colleague, this.other, { recursive: true, force: true });
    h.t.git('remote', 'set-url', 'origin', this.bare);
    this.colleague('remote', 'set-url', 'origin', this.bare);
    h.repo.state.remotes = [{ name: 'origin' }];
    void h.repo.status(); // the fake only learns the branch name now that there is a commit
    // What the Git extension's fetch does, with the options the flows pass
    h.repo.fetch = (async (o?: FetchOptions) => {
      this.fetched.push(o ?? {});
      h.t.git('fetch', '-q', ...(o?.all ? ['--all'] : o?.remote ? [o.remote] : []), ...(o?.prune ? ['--prune'] : []));
    }) as typeof h.repo.fetch;
  }

  server(...args: string[]) { return execFileSync('git', ['-C', this.bare, ...args], { encoding: 'utf8' }).trim(); }
  colleague(...args: string[]) { return execFileSync('git', ['-C', this.other, ...args], { encoding: 'utf8' }).trim(); }

  /** The colleague changes one line of a file and pushes. */
  upstream(file: string, line: number, text: string, message = `upstream ${file}`) {
    const rows = lines(30).split('\n');
    rows[line - 1] = text;
    writeFileSync(path.join(this.other, file), rows.join('\n'));
    this.colleague('commit', '-q', '-am', message);
    this.colleague('push', '-q', 'origin', 'main');
  }

  /** A local commit that changes one line of a file. */
  commitLocal(file: string, line: number, text: string, message: string) {
    this.local(file, line, text);
    this.h.t.commit(message);
  }

  /** A local change to one line of a file, not committed; `stage` also stages it. */
  local(file: string, line: number, text: string, stage = false) {
    const rows = lines(30).split('\n');
    rows[line - 1] = text;
    this.h.t.write(file, rows.join('\n'));
    if (stage) this.h.t.git('add', file);
  }

  fetch() { this.h.t.git('fetch', '-q', '--prune'); }
  stashes() { return this.h.t.git('stash', 'list').split('\n').filter(Boolean); }
  dispose() {
    this.h.dispose();
    rmSync(this.bare, { recursive: true, force: true });
    rmSync(this.other, { recursive: true, force: true });
  }
}

describe('what a pull would meet', () => {
  let s: Setup;
  beforeEach(() => { s = new Setup(); });
  afterEach(() => s.dispose());

  test('nothing local: only the number of new commits', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.fetch();
    assert.deepEqual(await s.h.svc.pullPreview('origin/main'), { behind: 1, changes: 0, overwritten: [] });
  });

  test('a local change in a file the upstream leaves alone is no problem', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('b.txt', 1, 'LOCAL');
    s.fetch();
    assert.deepEqual(await s.h.svc.pullPreview('origin/main'), { behind: 1, changes: 1, overwritten: [], reapplyConflicts: [] });
  });

  test('a change in a file the upstream changes, too, is named, and it comes back cleanly when the lines differ', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.fetch();
    assert.deepEqual(await s.h.svc.pullPreview('origin/main'), { behind: 1, changes: 1, overwritten: ['a.txt'], reapplyConflicts: [] });
  });

  test('the same line: the conflict is named in advance', async () => {
    s.upstream('a.txt', 1, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.local('b.txt', 5, 'ALSO LOCAL', true);
    s.fetch();
    const before = s.h.t.status();
    assert.deepEqual(await s.h.svc.pullPreview('origin/main'), { behind: 1, changes: 2, overwritten: ['a.txt'], reapplyConflicts: ['a.txt'] });
    assert.deepEqual(s.h.t.status(), before, 'looking changed nothing');
    assert.deepEqual(s.stashes(), [], 'and no stash was made');
  });

  test('nothing new upstream: nothing to look at', async () => {
    s.local('a.txt', 1, 'LOCAL');
    assert.deepEqual(await s.h.svc.pullPreview('origin/main'), { behind: 0, changes: 1, overwritten: [] });
  });

  test('during a conflict there is no stash to build, so no prediction rather than a wrong one', async () => {
    s.upstream('a.txt', 1, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.fetch();
    s.h.t.git('stash', '-q');
    s.h.t.tryGit('merge', 'origin/main');
    s.h.t.tryGit('stash', 'apply');
    assert.ok(s.h.t.status().some(l => l.startsWith('UU')), 'the setup has unmerged files');
    assert.equal((await s.h.svc.pullPreview('origin/main')).reapplyConflicts, undefined);
  });
});

describe('pull settings', () => {
  let s: Setup;
  beforeEach(() => { s = new Setup(); });
  afterEach(() => s.dispose());

  test('rebase only when the setting says plain true; the branch overrides the general setting', async () => {
    assert.equal(await s.h.svc.pullRebases('main'), false, 'unset');
    s.h.t.git('config', 'pull.rebase', 'true');
    assert.equal(await s.h.svc.pullRebases('main'), true);
    s.h.t.git('config', 'branch.main.rebase', 'false');
    assert.equal(await s.h.svc.pullRebases('main'), false, 'the branch wins');
    s.h.t.git('config', '--unset', 'branch.main.rebase');
    s.h.t.git('config', 'pull.rebase', 'merges');
    assert.equal(await s.h.svc.pullRebases('main'), false, 'merges and interactive are not offered as a plain rebase');
  });
});

describe('taking the upstream in', () => {
  let s: Setup;
  const leftovers = () => existsSync(path.join(s.h.t.dir, '.git', 'bonsai-rebase'));
  beforeEach(() => { s = new Setup(); });
  afterEach(() => s.dispose());

  test('a clean tree fast-forwards', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.fetch();
    assert.deepEqual(await s.h.svc.integrate('origin/main', { rebase: false, autostash: false }), { conflicted: false });
    assert.equal(s.h.t.git('log', '-1', '--format=%s').trim(), 'upstream a.txt');
  });

  test('with autostash the changes come back, staged ones staged, and no stash is left', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.local('b.txt', 3, 'STAGED', true);
    s.fetch();
    assert.deepEqual(await s.h.svc.integrate('origin/main', { rebase: false, autostash: true }), { conflicted: false });
    assert.deepEqual(s.h.t.status().sort(), [' M a.txt', 'M  b.txt']);
    assert.equal(s.h.t.git('show', ':b.txt').split('\n')[2], 'STAGED');
    assert.deepEqual(s.stashes(), []);
    assert.equal(leftovers(), false);
  });

  test('a file the upstream changed stays unstaged, so that nothing of the upstream is staged as a revert', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL', true);
    s.fetch();
    await s.h.svc.integrate('origin/main', { rebase: false, autostash: true });
    assert.deepEqual(s.h.t.status(), [' M a.txt']);
    assert.equal(s.h.t.git('show', ':a.txt').split('\n')[19], 'UP', 'the index is the new HEAD');
  });

  test('a stash that conflicts on the way back is a result: the output says so, the stash stays, the files are unmerged', async () => {
    s.upstream('a.txt', 1, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.fetch();
    const outcome = await s.h.svc.integrate('origin/main', { rebase: false, autostash: true });
    assert.equal(outcome.conflicted, true);
    assert.match(outcome.conflicted ? outcome.output : '', /stashed|conflicts/);
    assert.deepEqual(s.h.t.status(), ['UU a.txt']);
    assert.equal(s.stashes().length, 1, 'the way back is kept');
    assert.equal(leftovers(), false, 'nothing is waiting for the conflict to be resolved, so nothing is kept');
    assert.equal(await s.h.svc.mergeState(), undefined, 'and there is no running operation');
  });

  test('without autostash Git refuses, and says why', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.fetch();
    await assert.rejects(s.h.svc.integrate('origin/main', { rebase: false, autostash: false }), /overwritten/);
    assert.deepEqual(s.h.t.status(), [' M a.txt'], 'untouched');
  });

  test('a rebase takes local commits along, with the changes stashed and back again', async () => {
    s.h.t.commitFile('mine.txt', 'mine\n', 'local commit');
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    s.fetch();
    assert.deepEqual(await s.h.svc.integrate('origin/main', { rebase: true, autostash: true }), { conflicted: false });
    assert.equal(s.h.t.git('log', '--format=%s', '-2').trim(), 'local commit\nupstream a.txt', 'the local commit sits on top');
    assert.deepEqual(s.h.t.status(), [' M a.txt']);
  });

  test('a real merge conflict between commits stops as a running merge', async () => {
    s.commitLocal('a.txt', 2, 'MINE', 'local edit');
    s.upstream('a.txt', 2, 'THEIRS');
    s.fetch();
    const outcome = await s.h.svc.integrate('origin/main', { rebase: false, autostash: false });
    assert.equal(outcome.conflicted, true);
    assert.equal((await s.h.svc.mergeState())?.kind, 'merge');
  });

  test('nothing new: nothing happens, not even a stash', async () => {
    s.local('a.txt', 1, 'LOCAL');
    assert.deepEqual(await s.h.svc.integrate('origin/main', { rebase: false, autostash: true }), { conflicted: false });
    assert.deepEqual(s.h.t.status(), [' M a.txt']);
    assert.deepEqual(s.stashes(), []);
  });
});

describe('the pull in two steps', () => {
  let s: Setup;
  const prepare = () => handleRepoMessage({ type: 'pullPrepare' }, s.h.ctx);
  const info = () => s.h.posted.filter(m => m.type === 'pullInfo').map(m => (m as { info: PullInfo }).info);
  beforeEach(() => { s = new Setup(); });
  afterEach(() => s.dispose());

  test('step one fetches the upstream with prune and shows the dialog what it will meet', async () => {
    s.upstream('a.txt', 1, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    await prepare();
    assert.deepEqual(s.fetched, [{ remote: 'origin', prune: true }]);
    assert.deepEqual(info(), [{
      upstream: 'origin/main', into: 'main', rebase: false, behind: 1, changes: 1, overwritten: ['a.txt'], reapplyConflicts: ['a.txt'],
    }]);
    assert.deepEqual(s.h.t.status(), [' M a.txt'], 'and has not touched the working tree');
  });

  test('the dialog starts as rebase when the user configured it', async () => {
    s.h.t.git('config', 'pull.rebase', 'true');
    await prepare();
    assert.equal(info()[0].rebase, true);
  });

  test('branches that are gone on the server are removed by the pull, which a plain pull does not do', async () => {
    s.h.t.git('push', '-q', 'origin', 'main:refs/heads/old');
    s.fetch();
    assert.equal(s.h.t.tryGit('rev-parse', '--verify', '-q', 'refs/remotes/origin/old').code, 0);
    s.server('branch', '-D', 'old');
    await prepare();
    assert.equal(s.h.t.tryGit('rev-parse', '--verify', '-q', 'refs/remotes/origin/old').code, 1);
  });

  test('without an upstream the user is told, and no dialog opens', async () => {
    s.h.t.git('checkout', '-q', '-b', 'lonely');
    s.h.repo.state.HEAD = { name: 'lonely' };
    await prepare();
    assert.equal(s.h.ui.errors.length, 1);
    assert.match(s.h.ui.errors[0], /lonely/);
    assert.deepEqual(info(), []);
    assert.deepEqual(s.fetched, [], 'nothing was fetched');
  });

  test('an upstream that was deleted on the server is named as such', async () => {
    s.h.t.git('push', '-q', '-u', 'origin', 'main:refs/heads/feat');
    s.h.t.git('checkout', '-q', '-b', 'feat', '--track', 'origin/feat');
    s.server('branch', '-D', 'feat');
    s.h.repo.state.HEAD = { name: 'feat' };
    await prepare();
    assert.equal(s.h.ui.errors.length, 1);
    assert.match(s.h.ui.errors[0], /origin\/feat/);
    assert.deepEqual(info(), []);
  });

  test('step two with the stash box ticked: the changes come back', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    await prepare();
    await handleRepoMessage({ type: 'pull', rebase: false, stash: true }, s.h.ctx);
    assert.deepEqual(s.h.t.status(), [' M a.txt']);
    assert.equal(s.h.t.git('log', '-1', '--format=%s').trim(), 'upstream a.txt');
    assert.deepEqual(s.h.ui.informed, []);
  });

  test('step two with a conflict on the way back shows what Git printed, as after a merge', async () => {
    s.upstream('a.txt', 1, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    await prepare();
    await handleRepoMessage({ type: 'pull', rebase: false, stash: true }, s.h.ctx);
    assert.equal(s.h.ui.informed.length, 1);
    assert.match(s.h.ui.informed[0].detail, /conflicts/);
    assert.deepEqual(s.h.ui.conflictFiles, ['a.txt'], 'and which files it is about');
    assert.deepEqual(s.h.t.status(), ['UU a.txt']);
    assert.equal(s.h.repo.state.mergeChanges.length, 1, 'and the status was read again, so the banner can show it');
  });

  test('step two without the box, in the way: Git refuses and the user hears why', async () => {
    s.upstream('a.txt', 20, 'UP');
    s.local('a.txt', 1, 'LOCAL');
    await prepare();
    await assert.rejects(handleRepoMessage({ type: 'pull', rebase: false, stash: false }, s.h.ctx), /overwritten/);
  });
});

describe('the pull dialog remembers what was ticked', () => {
  let s: Setup;
  const prepare = () => handleRepoMessage({ type: 'pullPrepare' }, s.h.ctx);
  const infos = () => s.h.posted.filter(m => m.type === 'pullInfo').map(m => (m as { info: PullInfo }).info);
  beforeEach(() => { s = new Setup(); });
  afterEach(() => s.dispose());

  test('the first time there is nothing to remember', async () => {
    await prepare();
    assert.equal('last' in infos()[0], false);
  });

  test('a pull keeps both boxes for the next dialog, a cancelled dialog keeps nothing', async () => {
    await prepare(); // opened and cancelled: nothing was sent
    assert.equal(s.h.memory.has(PULL_CHOICE_KEY), false);
    s.upstream('b.txt', 20, 'UP');
    await handleRepoMessage({ type: 'pull', rebase: true, stash: true }, s.h.ctx);
    assert.deepEqual(s.h.memory.get(PULL_CHOICE_KEY), { rebase: true, stash: true });
    await prepare();
    assert.deepEqual(infos()[1].last, { rebase: true, stash: true });
  });

  test('what the user chose wins over the Git settings, which only decide the first time', async () => {
    s.h.t.git('config', 'pull.rebase', 'true');
    await handleRepoMessage({ type: 'pull', rebase: false, stash: false }, s.h.ctx);
    await prepare();
    assert.equal(infos()[0].rebase, true, 'the settings are still passed on');
    assert.deepEqual(infos()[0].last, { rebase: false, stash: false }, 'but the dialog starts with the last choice');
  });

  test('a stored value that is not two booleans is ignored', async () => {
    s.h.memory.set(PULL_CHOICE_KEY, { rebase: 'yes' });
    await prepare();
    assert.equal('last' in infos()[0], false);
  });
});

describe('fetching', () => {
  let s: Setup;
  beforeEach(() => { s = new Setup(); });
  afterEach(() => s.dispose());

  test('without a remote from all of them, with one from that one; both prune', async () => {
    await handleRepoMessage({ type: 'fetch' }, s.h.ctx);
    await handleRepoMessage({ type: 'fetch', remote: 'origin' }, s.h.ctx);
    assert.deepEqual(s.fetched, [{ all: true, prune: true }, { remote: 'origin', prune: true }]);
    assert.equal(s.h.apiCalls, 2, 'through the Git extension, like the old button');
  });
});
