import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { ActivityLog, ActivityRecorder, MAX_ENTRIES, MAX_OUTPUT, describeAction, formatCommand, isWriteCommand } from '../activityLog';
import { GitService } from '../gitService';
import type { Repository } from '../git';
import { TestRepo } from './helpers';

const repos: TestRepo[] = [];
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

describe('isWriteCommand', () => {
  test('commands that change the repository, past options in front; reading ones are left out, also `stash list`', () => {
    const cases: [string[], boolean][] = [
      [['add', '--', 'a'], true], [['apply', '--cached', '-'], true], [['merge', 'x'], true],
      [['stash', 'drop', 'stash@{0}'], true], [['push'], true], [['update-index', '-z'], true],
      [['--literal-pathspecs', 'stash', 'push', '-u', '--', 'a'], true],
      [['-c', 'core.editor=true', 'rebase', '--continue'], true],
      [['-c', 'x=y', '--no-pager', 'log'], false], [['-c', 'core.editor=true', '-c', 'a=b', 'log'], false],
      [['log', '-1'], false], [['diff', '--cached'], false], [['rev-parse', 'HEAD'], false],
      [['merge-tree', 'a', 'b'], false], [['merge-base', 'a', 'b'], false], [['stash', 'list'], false],
      [['config', 'user.email'], false], [['ls-files'], false],
      [['stash', 'create'], false], [['--literal-pathspecs', 'stash', 'create'], false], [['stash', 'push'], true],
    ];
    for (const [args, write] of cases) assert.equal(isWriteCommand(args), write, args.join(' '));
  });
});

describe('formatCommand', () => {
  test('quotes only what the shell would split', () => {
    assert.equal(formatCommand(['stash', 'apply', '--index', 'stash@{0}']), 'git stash apply --index stash@{0}');
    assert.equal(formatCommand(['commit', '-m', 'two words', '--', "it's.txt"]), `git commit -m 'two words' -- 'it'\\''s.txt'`);
  });
});

describe('describeAction', () => {
  test('fetch and pull: the dialog\'s choices lead to entries, the first half of a pull is a fetch', () => {
    assert.deepEqual(describeAction({ type: 'fetch' }), { title: 'Fetch', subtitle: undefined });
    assert.deepEqual(describeAction({ type: 'fetch', remote: 'origin' }), { title: 'Fetch', subtitle: 'origin' });
    assert.deepEqual(describeAction({ type: 'pullPrepare' }), { title: 'Fetch' });
    assert.deepEqual(describeAction({ type: 'pull', rebase: false, stash: true }), { title: 'Pull' });
    assert.deepEqual(describeAction({ type: 'pull', rebase: true, stash: false }), { title: 'Pull (rebase)' });
  });

  test('titles follow Fork, the subtitle names what it is about', () => {
    assert.deepEqual(describeAction({ type: 'stage', paths: ['a.txt'] }), { title: 'Stage 1 File', subtitle: 'a.txt' }, 'one file');
    assert.deepEqual(describeAction({ type: 'unstage', paths: ['a', 'b', 'c'] }), { title: 'Unstage 3 Files', subtitle: undefined }, 'several files');
    assert.equal(describeAction({ type: 'cherryPick', hash: 'a'.repeat(40) })?.subtitle, 'aaaaaaa', 'hashes are shortened');
    assert.equal(describeAction({ type: 'merge', ref: 'feat/x' })?.subtitle, 'feat/x', 'branch names are not');
    assert.deepEqual(describeAction({ type: 'commit', message: 'Fix it\n\nlong body', amend: false }), { title: 'Commit', subtitle: 'Fix it' }, 'commit: the subject line');
    assert.equal(describeAction({ type: 'commit', message: 'x', amend: true })?.title, 'Amend', 'amend has its own title');
    assert.deepEqual(describeAction({ type: 'stashFiles', paths: ['a', 'b'], message: 'wip' }), { title: 'Stash 2 Files', subtitle: 'wip' }, 'stash: the message');
    assert.deepEqual(describeAction({ type: 'stashFiles', paths: ['a'], message: '' }), { title: 'Stash 1 File', subtitle: 'a' }, 'stash: the file');
    assert.deepEqual(describeAction({ type: 'stashAction', action: 'drop', index: 0, name: 'On main: wip' }), { title: 'Delete stash', subtitle: 'wip' }, 'stash name without the Git prefix');
  });

  test('messages that only read or navigate have no entry', () => {
    for (const m of [{ type: 'ready' }, { type: 'refresh' }, { type: 'details', hash: 'x' }, { type: 'loadDiff', path: 'a', staged: false }, { type: 'activity' }, { type: 'interactiveRebase', hash: 'x' }] as const) {
      assert.equal(describeAction(m), undefined, m.type);
    }
  });
});

describe('ActivityLog', () => {
  const rec = (init: Partial<ActivityRecorder> = {}) => Object.assign(new ActivityRecorder(), init);
  const cmd = { command: 'git add -- a', output: '', ok: true };

  test('a cancelled dialog leaves no entry', () => {
    const log = new ActivityLog();
    assert.equal(log.record({ title: 'Merge' }, 'r', rec()), undefined);
    assert.equal(log.entries.length, 0);
  });

  test('an action that ran a command, called the API or failed is logged', () => {
    const log = new ActivityLog(() => 1000);
    assert.ok(log.record({ title: 'A' }, 'r', rec({ commands: [cmd] })));
    assert.ok(log.record({ title: 'B' }, 'r', rec({ api: true })));
    const failed = log.record({ title: 'C', subtitle: 'ignored' }, 'r', rec({ error: 'fatal: nope\nmore' }));
    assert.equal(failed?.ok, false);
    assert.equal(failed?.subtitle, 'fatal: nope');
    assert.deepEqual(log.entries.map(e => [e.title, e.ok, e.viaApi]), [['C', false, false], ['B', true, true], ['A', true, false]]);
  });

  test('keeps the newest entries only, with growing ids', () => {
    const log = new ActivityLog();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) log.record({ title: `#${i}` }, 'r', rec({ api: true }));
    assert.equal(log.entries.length, MAX_ENTRIES);
    assert.equal(log.entries[0].title, `#${MAX_ENTRIES + 4}`);
    assert.equal(log.entries[0].id, MAX_ENTRIES + 5);
  });

  test('long output is cut', () => {
    const log = new ActivityLog();
    const e = log.record({ title: 'A' }, 'r', rec({ commands: [{ ...cmd, output: 'x'.repeat(MAX_OUTPUT * 2) }] }));
    assert.ok(e!.commands[0].output.length <= MAX_OUTPUT + 2);
    assert.ok(e!.commands[0].output.endsWith('…'));
  });
});

describe('GitService trace', () => {
  test('reports every command with what it printed and whether it worked', async () => {
    const r = new TestRepo();
    repos.push(r);
    r.commitFile('a.txt', 'one\n');
    const seen: { args: string[]; stdout: string; ok: boolean }[] = [];
    const svc = new GitService('git', { rootUri: { fsPath: r.dir } } as unknown as Repository, (args, stdout, _stderr, ok) => seen.push({ args, stdout, ok }));

    await svc.run(['rev-parse', 'HEAD']);
    await assert.rejects(svc.run(['checkout', 'no-such-branch']));
    await svc.run(['diff', '--no-index', '--', 'a.txt', 'a.txt'], undefined, [1]);

    assert.deepEqual(seen.map(s => [s.args[0], s.ok]), [['rev-parse', true], ['checkout', false], ['diff', true]]);
    assert.match(seen[0].stdout, /^[0-9a-f]{40}\n$/);
    assert.equal(seen.filter(s => isWriteCommand(s.args)).length, 1);
  });
});
