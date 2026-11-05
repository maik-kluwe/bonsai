import { afterEach, beforeEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { FlowHarness } from './flowHarness';
import { handleRepoMessage } from '../messages';
import { EMPTY_TREE, compareRefs } from '../diffTargets';
import { createdRemoteBranch, isAuthFailure, pushArgs, remoteMessages } from '../operations';

const push = { branch: 'main', remote: 'origin', remoteBranch: 'main', track: false, tags: false, force: false };

describe('push arguments', () => {
  test('branch and target are named in full, so a tag of the same name does not get in the way', () => {
    assert.deepEqual(pushArgs(push), ['push', 'origin', 'refs/heads/main:refs/heads/main']);
  });

  test('options', () => {
    assert.deepEqual(pushArgs({ ...push, track: true, tags: true, force: true, remoteBranch: 'other' }),
      ['push', '-u', '--tags', '--force-with-lease', 'origin', 'refs/heads/main:refs/heads/other']);
  });
});

describe('what Git printed', () => {
  test('the lines of the server, or nothing when it said nothing', () => {
    assert.equal(remoteMessages('remote: hello\nremote:\nTo x\n   a..b  main -> main\n'), 'remote: hello\nremote:\nTo x\n   a..b  main -> main');
    assert.equal(remoteMessages('remote:\nremote:   \nTo x\n'), '');
    assert.equal(remoteMessages('To x\n   a..b  main -> main\n'), '');
  });

  test('a new remote branch shows by the mark of Git, in any language', () => {
    const line = (flag: string, text: string) => `To x\n ${flag} ${text}\n`;
    assert.equal(createdRemoteBranch(line('*', '[new branch]      feat/x -> feat/x'), 'feat/x'), true);
    assert.equal(createdRemoteBranch(line('*', '[neuer Branch]    feat/x -> feat/x'), 'feat/x'), true);
    assert.equal(createdRemoteBranch(line(' ', '  a..b  feat/x -> feat/x'), 'feat/x'), false);
    assert.equal(createdRemoteBranch(line('+', 'a...b feat/x -> feat/x (forced update)'), 'feat/x'), false);
    assert.equal(createdRemoteBranch(line('*', '[new tag]         v1 -> v1'), 'feat/x'), false, 'only a tag is new');
  });

  test('a missing sign-in is told apart from a rejected push', () => {
    for (const s of ['fatal: could not read Username for \'https://x\': terminal prompts disabled', 'git@x: Permission denied (publickey).', 'Host key verification failed.', 'remote: HTTP Basic: Access denied\nfatal: Authentication failed for \'https://x\'']) {
      assert.equal(isAuthFailure(s), true, s);
    }
    assert.equal(isAuthFailure('! [rejected] main -> main (non-fast-forward)'), false);
    assert.equal(isAuthFailure('remote: GitLab: You are not allowed to push code to protected branches'), false);
  });
});

describe('deleting branches', () => {
  let h: FlowHarness;
  let bare: string;
  const remote = (...args: string[]) => execFileSync('git', ['-C', bare, ...args], { encoding: 'utf8' }).trim();
  const del = (name: string) => handleRepoMessage({ type: 'deleteBranch', name }, h.ctx);
  const has = (ref: string) => h.t.tryGit('rev-parse', '--verify', '-q', ref).code === 0;
  const onServer = (branch: string) => remote('for-each-ref', `refs/heads/${branch}`) !== '';

  /** A branch one commit ahead of main, or at main when `commit` is false. */
  const branch = (name: string, commit = true) => {
    h.t.git('checkout', '-q', '-b', name);
    if (commit) h.t.commitFile('g.txt', 'x\n');
    h.t.git('checkout', '-q', 'main');
  };

  beforeEach(() => {
    h = new FlowHarness();
    bare = mkdtempSync(path.join(tmpdir(), 'bonsai-remote-'));
    remote('init', '-q', '--bare', '-b', 'main');
    h.t.git('remote', 'add', 'origin', bare);
    h.repo.state.remotes = [{ name: 'origin' }];
    h.t.commitFile('f.txt', 'one\n');
    h.t.git('push', '-q', 'origin', 'main');
  });
  afterEach(() => { h.dispose(); rmSync(bare, { recursive: true, force: true }); });

  test('a branch nothing depends on goes without a warning', async () => {
    branch('done', false);
    await del('done');
    assert.equal(h.ui.detail, undefined);
    assert.deepEqual(h.ui.offered, ['Delete']);
    assert.equal(has('refs/heads/done'), false);
  });

  test('commits only this branch has are named, and dismissing keeps it', async () => {
    branch('work');
    h.ui.chooseAnswer = () => undefined;
    await del('work');
    assert.match(h.ui.detail ?? '', /^1 commit/);
    assert.equal(has('refs/heads/work'), true);

    h.ui.chooseAnswer = b => b[0];
    await del('work');
    assert.equal(has('refs/heads/work'), false, 'not merged, deleted all the same');
  });

  test('a pushed branch stays on the server unless asked', async () => {
    branch('feat/x');
    h.t.git('push', '-q', '-u', 'origin', 'feat/x');
    await del('feat/x');
    assert.match(h.ui.detail ?? '', /^1 commit.*Deleting both/);
    assert.deepEqual(h.ui.offered, ['Delete', 'Also delete origin/feat/x']);
    assert.equal(has('refs/heads/feat/x'), false);
    assert.equal(onServer('feat/x'), true);
  });

  test('both go on request', async () => {
    branch('feat/x');
    h.t.git('push', '-q', '-u', 'origin', 'feat/x');
    h.ui.chooseAnswer = b => b[1];
    await del('feat/x');
    assert.equal(has('refs/heads/feat/x'), false);
    assert.equal(has('refs/remotes/origin/feat/x'), false);
    assert.equal(onServer('feat/x'), false);
  });

  test('a refused push leaves the local branch in place', async () => {
    branch('feat/x');
    h.t.git('push', '-q', '-u', 'origin', 'feat/x');
    writeFileSync(path.join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n');
    h.ui.chooseAnswer = b => b[1];
    await del('feat/x').catch(() => undefined);
    assert.equal(onServer('feat/x'), true);
    assert.equal(has('refs/heads/feat/x'), true);
  });

  test('an upstream that is gone is not offered, and neither is a local one', async () => {
    branch('gone');
    h.t.git('push', '-q', '-u', 'origin', 'gone');
    remote('branch', '-q', '-D', 'gone');
    h.t.git('fetch', '-q', '--prune');
    branch('tracksMain');
    h.t.git('branch', '-q', '--set-upstream-to=main', 'tracksMain');
    for (const name of ['gone', 'tracksMain']) {
      await del(name);
      assert.deepEqual(h.ui.offered, ['Delete'], name);
    }
  });

  test('a remote branch: asks, then deletes it on the server only', async () => {
    branch('feat/x');
    h.t.git('push', '-q', 'origin', 'feat/x');
    const send = () => handleRepoMessage({ type: 'deleteRemoteBranch', name: 'origin/feat/x' }, h.ctx);
    h.ui.confirmAnswer = false;
    await send();
    assert.equal(onServer('feat/x'), true);
    assert.equal(h.ui.detail, undefined, 'the local branch still has the commits');

    h.ui.confirmAnswer = true;
    await send();
    assert.equal(onServer('feat/x'), false);
    assert.equal(has('refs/heads/feat/x'), true);
  });

  test('without a stored sign-in the Git extension deletes it', async () => {
    h.t.git('push', '-q', 'origin', 'main:old');
    h.t.git('fetch', '-q', 'origin');
    const pushed: string[] = [];
    h.svc.pushRefspec = async () => { throw new Error('git@x: Permission denied (publickey).'); };
    h.repo.push = (async (_: string, spec: string) => { pushed.push(spec); }) as typeof h.repo.push;
    await handleRepoMessage({ type: 'deleteRemoteBranch', name: 'origin/old' }, h.ctx);
    assert.deepEqual(pushed, [':refs/heads/old']);
  });
});

describe('renaming, tracking, tags', () => {
  let h: FlowHarness;
  let bare: string;
  const remote = (...args: string[]) => execFileSync('git', ['-C', bare, ...args], { encoding: 'utf8' }).trim();
  const has = (ref: string) => h.t.tryGit('rev-parse', '--verify', '-q', ref).code === 0;
  const upstream = (name: string) => h.t.tryGit('rev-parse', '--abbrev-ref', `${name}@{u}`).out.trim();

  beforeEach(() => {
    h = new FlowHarness();
    bare = mkdtempSync(path.join(tmpdir(), 'bonsai-remote-'));
    remote('init', '-q', '--bare', '-b', 'main');
    h.t.git('remote', 'add', 'origin', bare);
    h.repo.state.remotes = [{ name: 'origin' }];
    h.t.commitFile('f.txt', 'one\n');
    h.t.git('push', '-q', 'origin', 'main', 'main:other');
    h.t.git('branch', 'feat');
  });
  afterEach(() => { h.dispose(); rmSync(bare, { recursive: true, force: true }); });

  test('a rename moves the branch and keeps its upstream; the same name or a cancel does nothing', async () => {
    h.t.git('branch', '-q', '--set-upstream-to=origin/other', 'feat');
    const rename = () => handleRepoMessage({ type: 'renameBranch', name: 'feat' }, h.ctx);
    for (const answer of [undefined, 'feat']) {
      h.ui.inputAnswer = answer;
      await rename();
      assert.equal(has('refs/heads/feat'), true);
    }
    h.ui.inputAnswer = 'feat/new';
    await rename();
    assert.equal(has('refs/heads/feat'), false);
    assert.equal(upstream('feat/new'), 'origin/other');
  });

  test('tracking: choose a remote branch, then remove it again', async () => {
    const tracking = () => handleRepoMessage({ type: 'setTracking', name: 'feat' }, h.ctx);
    h.ui.pickAnswer = items => items.find(i => i.label === 'origin/other');
    await tracking();
    assert.deepEqual(h.ui.offered, ['origin/main', 'origin/other'], 'nothing to remove yet');
    assert.equal(upstream('feat'), 'origin/other');

    h.ui.pickAnswer = items => items[0];
    await tracking();
    assert.deepEqual(h.ui.offered, ['Remove tracking reference', 'origin/main', 'origin/other']);
    assert.notEqual(upstream('feat'), 'origin/other');
  });

  test('tracking: without remote branches there is nothing to pick', async () => {
    h.t.git('branch', '-q', '-r', '-D', 'origin/main', 'origin/other');
    await handleRepoMessage({ type: 'setTracking', name: 'feat' }, h.ctx);
    assert.equal(h.ui.errors.length, 1);
    assert.deepEqual(h.ui.asked, []);
  });

  test('a tag lands on the commit, a cancel creates none', async () => {
    const hash = h.t.git('rev-parse', 'HEAD').trim();
    h.t.commitFile('f.txt', 'two\n');
    h.ui.inputAnswer = undefined;
    await handleRepoMessage({ type: 'createTagAt', hash }, h.ctx);
    assert.equal(h.t.git('tag').trim(), '');
    h.ui.inputAnswer = 'v1';
    await handleRepoMessage({ type: 'createTagAt', hash }, h.ctx);
    assert.equal(h.t.git('rev-parse', 'v1').trim(), hash);
  });

  test('a tag goes locally, or also on the remote, even with a branch of the same name', async () => {
    h.t.git('tag', 'feat');
    h.t.git('push', '-q', 'origin', 'refs/tags/feat', 'main:refs/heads/feat');
    const del = () => handleRepoMessage({ type: 'deleteTag', name: 'feat' }, h.ctx);
    await del();
    assert.deepEqual(h.ui.offered, ['Delete', 'Also delete on origin']);
    assert.equal(has('refs/tags/feat'), false);
    assert.notEqual(remote('for-each-ref', 'refs/tags/feat'), '');

    h.t.git('tag', 'feat');
    h.ui.chooseAnswer = b => b[1];
    await del();
    assert.equal(has('refs/tags/feat'), false);
    assert.equal(remote('for-each-ref', 'refs/tags/feat'), '');
    assert.notEqual(remote('for-each-ref', 'refs/heads/feat'), '');
  });
});

describe('syncing from the menu', () => {
  let h: FlowHarness;
  let bare: string;
  const remote = (...args: string[]) => execFileSync('git', ['-C', bare, ...args], { encoding: 'utf8' }).trim();
  const rev = (ref: string) => h.t.git('rev-parse', ref).trim();

  /** `dev` tracks origin/dev and is one commit behind it; main stays checked out. */
  beforeEach(() => {
    h = new FlowHarness();
    bare = mkdtempSync(path.join(tmpdir(), 'bonsai-remote-'));
    remote('init', '-q', '--bare', '-b', 'main');
    h.t.git('remote', 'add', 'origin', bare);
    h.repo.state.remotes = [{ name: 'origin' }];
    h.t.commitFile('f.txt', 'one\n');
    h.t.git('push', '-q', 'origin', 'main', 'main:dev');
    h.t.git('fetch', '-q', 'origin');
    h.t.git('branch', '-q', '--track', 'dev', 'origin/dev');
    h.t.git('checkout', '-q', 'dev');
    h.t.commitFile('g.txt', 'two\n');
    h.t.git('push', '-q', 'origin', 'dev');
    h.t.git('reset', '-q', '--hard', 'HEAD~1');
    h.t.git('checkout', '-q', 'main');
  });
  afterEach(() => { h.dispose(); rmSync(bare, { recursive: true, force: true }); });

  const forward = (name: string) => handleRepoMessage({ type: 'fastForward', name }, h.ctx);

  test('fast-forward moves the branch and leaves the checkout alone', async () => {
    const main = rev('HEAD');
    await forward('dev');
    assert.equal(rev('dev'), rev('origin/dev'));
    assert.equal(rev('HEAD'), main);
  });

  test('a branch that went its own way is refused, not reset', async () => {
    h.t.git('checkout', '-q', 'dev');
    h.t.commitFile('h.txt', 'own\n');
    const own = rev('HEAD');
    h.t.git('checkout', '-q', 'main');
    await assert.rejects(forward('dev'));
    assert.equal(rev('dev'), own);
  });

  test('a tag goes to the chosen remote, a dismissed question sends nothing', async () => {
    h.t.git('tag', 'v1');
    const send = () => handleRepoMessage({ type: 'pushTag', name: 'v1' }, h.ctx);
    h.ui.chooseAnswer = () => undefined;
    await send();
    assert.equal(remote('for-each-ref', 'refs/tags/v1'), '');
    h.ui.chooseAnswer = b => b[0];
    await send();
    assert.deepEqual(h.ui.offered, ['Push to origin']);
    assert.notEqual(remote('for-each-ref', 'refs/tags/v1'), '');
  });

  test('a tag without a remote to go to says so', async () => {
    h.repo.state.remotes = [];
    await handleRepoMessage({ type: 'pushTag', name: 'v1' }, h.ctx);
    assert.equal(h.ui.errors.length, 1);
    assert.deepEqual(h.ui.asked, []);
  });

  test('pull into fetches first, then merges what is on the server by now', async () => {
    const newest = remote('rev-parse', 'refs/heads/dev');
    const fetched: unknown[] = [];
    h.t.git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    h.repo.fetch = (async (o: unknown) => { fetched.push(o); h.t.git('fetch', '-q', 'origin'); }) as typeof h.repo.fetch;
    await handleRepoMessage({ type: 'pullInto', ref: 'origin/dev' }, h.ctx);
    assert.deepEqual(fetched, [{ remote: 'origin', ref: 'dev' }]);
    assert.equal(h.t.tryGit('merge-base', '--is-ancestor', newest, 'HEAD').code, 0);
  });
});

describe('commits from the menu', () => {
  let h: FlowHarness;
  const rev = (ref: string) => h.t.git('rev-parse', ref).trim();
  beforeEach(() => { h = new FlowHarness(); h.t.commitFile('f.txt', 'one\n', 'first'); });
  afterEach(() => h.dispose());

  test('the range onto a ref holds what the current branch has and it lacks, oldest first', async () => {
    h.t.git('branch', 'other');
    h.t.commitFile('a.txt', 'a\n', 'one');
    h.t.commitFile('b.txt', 'b\n', 'two');
    const range = await h.svc.rebaseRangeOnto('other');
    assert.equal(range.base, 'other');
    assert.deepEqual(range.commits.map(c => c.subject), ['one', 'two']);
    assert.deepEqual((await h.svc.rebaseRangeOnto('HEAD')).commits, []);
  });

  test('an interactive rebase onto a branch puts the commits on top of it', async () => {
    h.t.git('checkout', '-q', '-b', 'other');
    h.t.commitFile('o.txt', 'o\n', 'theirs');
    h.t.git('checkout', '-q', '-');
    h.t.commitFile('a.txt', 'a\n', 'one');
    h.t.commitFile('b.txt', 'b\n', 'two');
    const range = await h.svc.rebaseRangeOnto('other');
    await h.svc.interactiveRebase(range.base, range.commits.map(c => ({ ...c, action: 'pick' as const })), { autostash: false });
    assert.deepEqual(h.t.git('log', '--reverse', '--format=%s').trim().split(/\s+/), ['first', 'theirs', 'one', 'two']);
  });

  test('compare lists what differs from the commit, untracked files as added', async () => {
    h.t.commitFile('gone.txt', 'x\n');
    const hash = rev('HEAD');
    h.t.commitFile('later.txt', 'y\n');
    h.t.git('rm', '-q', 'gone.txt');
    h.t.write('f.txt', 'two\n');
    h.t.write('new.txt', 'n\n');
    const files = await h.svc.changedSince(hash);
    assert.deepEqual(files.map(f => `${f.status} ${f.path}`).sort(), ['A later.txt', 'A new.txt', 'D gone.txt', 'M f.txt']);
    h.t.git('reset', '-q', '--hard', hash);
    h.t.git('clean', '-fdq');
    assert.deepEqual(await h.svc.changedSince(hash), []);
  });

  test('sides of the comparison: what a side lacks is the empty tree, the right side is the working tree', () => {
    assert.deepEqual(compareRefs('h', 'M'), { left: 'h', right: undefined });
    assert.deepEqual(compareRefs('h', 'A'), { left: EMPTY_TREE, right: undefined });
    assert.deepEqual(compareRefs('h', 'D'), { left: 'h', right: EMPTY_TREE });
  });

  test('commit info holds the hash, the author and the whole message', async () => {
    h.t.git('commit', '-q', '--allow-empty', '-m', 'subject', '-m', 'body');
    const info = await h.svc.commitInfo(rev('HEAD'));
    assert.match(info, new RegExp(`^commit ${rev('HEAD')}`));
    assert.match(info, /Author: /);
    assert.match(info, /subject/);
    assert.match(info, /body/);
  });

  test('a patch lands where the dialog says, named after the subject', async () => {
    const hash = rev('HEAD');
    const dir = mkdtempSync(path.join(tmpdir(), 'bonsai-patch-'));
    const file = path.join(dir, 'x.patch');
    try {
      const send = () => handleRepoMessage({ type: 'savePatch', hash, subject: 'Fix: größe / maß' }, h.ctx);
      await send();
      assert.match(h.ui.asked[0], /Fix-größe-maß[.]patch$/);
      assert.equal(existsSync(file), false, 'cancelled');
      h.ui.saveAnswer = file;
      await send();
      assert.match(readFileSync(file, 'utf8'), new RegExp(`^From ${hash} `));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pushing', () => {
  let h: FlowHarness;
  let bare: string;
  const remote = (...args: string[]) => execFileSync('git', ['-C', bare, ...args], { encoding: 'utf8' }).trim();

  beforeEach(() => {
    h = new FlowHarness();
    bare = mkdtempSync(path.join(tmpdir(), 'bonsai-remote-'));
    remote('init', '-q', '--bare', '-b', 'main');
    h.t.git('remote', 'add', 'origin', bare);
    h.t.commitFile('f.txt', 'one\n');
  });
  afterEach(() => { h.dispose(); rmSync(bare, { recursive: true, force: true }); });

  const send = (o = {}) => handleRepoMessage({ type: 'push', ...push, ...o }, h.ctx);
  const results = () => h.posted.flatMap(m => (m.type === 'pushResult' ? [m.output] : []));

  test('a new branch lands on the server and tracks it', async () => {
    h.t.git('checkout', '-q', '-b', 'feat/x');
    await send({ branch: 'feat/x', remoteBranch: 'feat/x', track: true });
    assert.equal(remote('rev-parse', 'refs/heads/feat/x'), h.t.git('rev-parse', 'HEAD').trim());
    assert.equal(h.t.git('rev-parse', '--abbrev-ref', '@{u}').trim(), 'origin/feat/x');
  });

  test('what the server says comes back, link included', async () => {
    writeFileSync(path.join(bare, 'hooks', 'post-receive'), '#!/bin/sh\necho "To create a merge request, visit:"\necho "  https://gitlab.example.com/mr/new"\n');
    await send();
    assert.equal(results().length, 1);
    assert.match(results()[0], /remote: +https:\/\/gitlab\.example\.com\/mr\/new/);
  });

  test('the second push to the branch stays quiet, whatever the server says', async () => {
    writeFileSync(path.join(bare, 'hooks', 'post-receive'), '#!/bin/sh\necho "https://gitlab.example.com/mr/new"\n');
    await send();
    assert.equal(results().length, 1);
    h.t.commitFile('f.txt', 'two\n');
    await send();
    assert.equal(results().length, 1);
  });

  test('without a word from the server no window opens', async () => {
    await send();
    assert.deepEqual(results(), []);
  });

  test('a push that is behind is refused, and force goes through with the lease', async () => {
    await send();
    h.t.commitFile('f.txt', 'two\n');
    await send();
    h.t.git('reset', '-q', '--hard', 'HEAD~1');
    h.t.commitFile('f.txt', 'three\n');
    await assert.rejects(send(), /rejected|fetch first|non-fast-forward/);
    await send({ force: true });
    assert.equal(remote('rev-parse', 'refs/heads/main'), h.t.git('rev-parse', 'HEAD').trim());
  });

  test('a missing sign-in falls back to the Git extension, which can ask for it', async () => {
    let viaApi: unknown[] = [];
    h.repo.push = (async (...a: unknown[]) => { viaApi = a; }) as typeof h.repo.push;
    h.svc.push = async () => { throw new Error("fatal: could not read Username for 'https://x': terminal prompts disabled"); };
    await send({ track: true, force: true });
    assert.equal(viaApi[0], 'origin');
    assert.equal(viaApi[1], 'main:main');
    assert.equal(viaApi[2], true);
  });

  test('tags cannot go through the Git extension: then the error stays', async () => {
    h.svc.push = async () => { throw new Error('fatal: Authentication failed'); };
    await assert.rejects(send({ tags: true }), /Authentication failed/);
  });
});
