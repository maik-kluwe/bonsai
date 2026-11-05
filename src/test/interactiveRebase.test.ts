import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { existsSync } from 'fs';
import * as path from 'path';
import type { PlanEntry } from '../gitService';
import { TestRepo } from './helpers';

type Entry = { hash: string; subject?: string; message: string; action: string; edited?: string };
const plan: {
  groups(e: Entry[]): { head: number; members: number[] }[];
  problem(e: Entry[]): string | null;
  analyse(e: Entry[]): { needsMessage: boolean; defaultMessage: string }[];
  build(e: Entry[], p: (n: number) => string): { todo: string; messages: string[] };
} = require('../../media/rebaseplan.js');

const e = (hash: string, action: string, message = hash, edited?: string): Entry => ({ hash, action, message, edited });
const path1 = (n: number) => `/m/${n}`;

describe('rebase plan', () => {
  test('builds the todo list and the messages it needs', () => {
    const amend = 'exec git commit --amend --allow-empty -F "/m/1"\n';
    const cases: [string, Entry[], string, string[]][] = [
      ['picks and drops map one to one', [e('a', 'pick'), e('b', 'drop'), e('c', 'pick')], 'pick a\ndrop b\npick c\n', []],
      ['reword amends right after the pick', [e('a', 'pick'), e('b', 'reword', 'old', 'new\n\nbody')], `pick a\npick b\n${amend}`, ['new\n\nbody\n']],
      ['a squash becomes a fixup and adds its message, a fixup does not; the amend comes after the last member', [e('a', 'pick', 'one'), e('b', 'squash', 'two'), e('c', 'fixup', 'three'), e('d', 'pick', 'four')], `pick a\nfixup b\nfixup c\n${amend}pick d\n`, ['one\n\ntwo\n']],
      ['only fixups: no message', [e('a', 'pick'), e('b', 'fixup')], 'pick a\nfixup b\n', []],
      ['a dropped commit between two members does not break the group', [e('a', 'pick', 'one'), e('b', 'drop'), e('c', 'squash', 'three')], `pick a\ndrop b\nfixup c\n${amend}`, ['one\n\nthree\n']],
    ];
    for (const [name, entries, todo, messages] of cases) {
      const p = plan.build(entries, path1);
      assert.equal(p.todo, todo, name);
      assert.deepEqual(p.messages, messages, name);
    }
  });

  test('a squash after a dropped head melts into the kept commit before it', () => {
    assert.deepEqual(plan.groups([e('a', 'pick'), e('b', 'drop'), e('c', 'squash')]), [{ head: 0, members: [2] }]);
  });

  test('the text the user wrote wins over the default', () => {
    const [info] = plan.analyse([e('a', 'reword', 'old', 'mine')]);
    assert.equal(info.needsMessage, true);
    assert.equal(info.defaultMessage, 'old');
    assert.equal(plan.build([e('a', 'reword', 'old', 'mine')], path1).messages[0], 'mine\n');
  });

  test('problems: nothing kept, the oldest kept commit melts into nothing, an empty message', () => {
    assert.equal(plan.problem([e('a', 'drop')]), 'nothingKept');
    assert.equal(plan.problem([e('a', 'squash'), e('b', 'pick')]), 'firstMelts');
    assert.equal(plan.problem([e('a', 'drop'), e('b', 'fixup'), e('c', 'pick')]), 'firstMelts');
    assert.equal(plan.problem([e('a', 'reword', 'old', '  ')]), 'emptyMessage');
    assert.equal(plan.problem([e('a', 'pick'), e('b', 'reword')]), null);
    assert.throws(() => plan.build([e('a', 'drop')], path1), /not valid/);
  });
});

const repos: TestRepo[] = [];
const create = () => { const r = new TestRepo(); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

/** base -> c1 -> c2 -> c3 -> c4, each commit touches its own file (unless said otherwise). */
function history(r: TestRepo) {
  const base = r.commitFile('base.txt', 'base\n', 'base');
  const [c1, c2, c3, c4] = [1, 2, 3, 4].map(i => r.commitFile(`f${i}.txt`, `${i}\n`, `c${i}\n\nbody ${i}`));
  return { base, c: [c1, c2, c3, c4] };
}
const subjects = (r: TestRepo) => r.git('log', '--reverse', '--format=%s').trim().split('\n');
const entries = async (r: TestRepo, from: string, actions: Record<number, string> = {}, edited: Record<number, string> = {}): Promise<{ base: string; list: PlanEntry[] }> => {
  const range = await r.svc.rebaseRange(from);
  return { base: range.base, list: range.commits.map((c, i) => ({ ...c, action: (actions[i] ?? 'pick') as PlanEntry['action'], edited: edited[i] })) };
};

describe('rebaseRange', () => {
  test('lists the commits from the chosen one to HEAD, oldest first, with full messages', async () => {
    const r = create();
    const { base, c } = history(r);
    const range = await r.svc.rebaseRange(c[1]);
    assert.equal(range.base, c[0]);
    assert.deepEqual(range.commits.map(x => x.subject), ['c2', 'c3', 'c4']);
    assert.equal(range.commits[0].message, 'c2\n\nbody 2');
    assert.ok(range.onBranch && !range.merges);
    assert.equal((await r.svc.rebaseRange(c[0])).base, base);
  });

  test('a commit that is not on the current branch is reported', async () => {
    const r = create();
    history(r);
    r.git('checkout', '-q', '-b', 'side', 'HEAD~2');
    const other = r.commitFile('x.txt', 'x\n', 'other');
    r.git('checkout', '-q', 'main');
    assert.equal((await r.svc.rebaseRange(other)).onBranch, false);
  });

  test('merge commits in the range are reported', async () => {
    const r = create();
    const { c } = history(r);
    r.git('checkout', '-q', '-b', 'side', c[1]);
    r.commitFile('s.txt', 's\n', 'side');
    r.git('checkout', '-q', 'main');
    r.git('merge', '--no-ff', '-q', '-m', 'merge side', 'side');
    assert.equal((await r.svc.rebaseRange(c[2])).merges, true);
  });
});

describe('interactiveRebase', () => {
  test('reorders commits', async () => {
    const r = create();
    const { c } = history(r);
    const { base, list } = await entries(r, c[0]);
    const swapped = [list[2], list[0], list[1], list[3]]; // c3, c1, c2, c4
    assert.deepEqual(await r.svc.interactiveRebase(base, swapped, { autostash: false }), { conflicted: false });
    assert.deepEqual(subjects(r), ['base', 'c3', 'c1', 'c2', 'c4']);
    assert.equal(r.git('status', '--short').trim(), '');
  });

  test('drop removes the commit and its changes', async () => {
    const r = create();
    const { c } = history(r);
    const { base, list } = await entries(r, c[0], { 1: 'drop' });
    await r.svc.interactiveRebase(base, list, { autostash: false });
    assert.deepEqual(subjects(r), ['base', 'c1', 'c3', 'c4']);
    assert.equal(existsSync(path.join(r.dir, 'f2.txt')), false);
  });

  test('reword changes subject and body without touching content or author', async () => {
    const r = create();
    const { c } = history(r);
    const { base, list } = await entries(r, c[1], { 1: 'reword' }, { 1: 'better subject\n\nbetter body' });
    await r.svc.interactiveRebase(base, list, { autostash: false });
    assert.deepEqual(subjects(r), ['base', 'c1', 'c2', 'better subject', 'c4']);
    assert.equal(r.git('log', '-3', '--format=%B', '--skip=1').trim().split('\n')[0], 'better subject');
    assert.match(r.git('log', '--format=%B', '--grep=better subject'), /better body/);
    assert.equal(r.git('show', 'HEAD~1:f3.txt'), '3\n');
  });

  test('squash melts the commits into one with the combined message; fixup drops its message', async () => {
    const r = create();
    const { c } = history(r);
    const { base, list } = await entries(r, c[0], { 1: 'squash', 2: 'fixup' });
    const [info] = [list[0]];
    assert.equal(info.hash, c[0]);
    await r.svc.interactiveRebase(base, list, { autostash: false });
    assert.deepEqual(subjects(r), ['base', 'c1', 'c4']);
    const msg = r.git('log', '--format=%B', '-n1', 'HEAD~1');
    assert.match(msg, /body 1/);
    assert.match(msg, /body 2/);
    assert.doesNotMatch(msg, /body 3/);
    for (const f of ['f1.txt', 'f2.txt', 'f3.txt']) assert.ok(existsSync(path.join(r.dir, f)), f);
  });

  test('squash with an edited message uses the text the user wrote', async () => {
    const r = create();
    const { c } = history(r);
    const { base, list } = await entries(r, c[2], { 1: 'squash' }, { 0: 'combined\n\nby hand' });
    await r.svc.interactiveRebase(base, list, { autostash: false });
    assert.deepEqual(subjects(r), ['base', 'c1', 'c2', 'combined']);
    assert.match(r.git('log', '-n1', '--format=%B'), /by hand/);
  });

  test('a conflict stops the rebase; the reword still happens after continue, and the files are cleaned up', async () => {
    const r = create();
    r.commitFile('a.txt', 'one\n', 'base');
    const edit1 = r.commitFile('a.txt', 'two\n', 'edit 1');
    r.commitFile('a.txt', 'three\n', 'edit 2');
    const { base, list } = await entries(r, edit1, { 0: 'drop', 1: 'reword' }, { 1: 'edit two, reworded' });
    const outcome = await r.svc.interactiveRebase(base, list, { autostash: false });
    assert.equal(outcome.conflicted, true, 'edit 2 no longer applies without edit 1');
    // The todo list has a drop, a pick and an exec; only the pick is a step
    assert.deepEqual((await r.svc.mergeState())!.rebase, { branch: 'main', step: 1, total: 1 });
    const dir = path.join(r.dir, '.git', 'bonsai-rebase');
    assert.ok(existsSync(dir), 'the message file must outlast the stop');
    r.write('a.txt', 'resolved\n');
    r.git('add', 'a.txt');
    assert.deepEqual(await r.svc.rebaseContinue(), { conflicted: false });
    assert.deepEqual(subjects(r), ['base', 'edit two, reworded']);
    assert.equal(existsSync(dir), false);
  });
});

describe('planEntries (what the host accepts from the dialog)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { planEntries } = require('../interactiveRebase') as typeof import('../interactiveRebase');
  const commits = [{ hash: 'a', subject: 'A', message: 'A' }, { hash: 'b', subject: 'B', message: 'B' }];

  test('takes subject and message from the host, action and edited text from the dialog', () => {
    const out = planEntries(commits, [{ hash: 'b', action: 'reword', edited: 'new' }, { hash: 'a', action: 'pick' }]);
    assert.deepEqual(out.map(x => [x.hash, x.action, x.message, x.edited]), [['b', 'reword', 'B', 'new'], ['a', 'pick', 'A', undefined]]);
  });

  test('refuses other commits, missing or doubled ones, unknown actions and invalid plans', () => {
    assert.throws(() => planEntries(commits, [{ hash: 'a', action: 'pick' }]), /changed/);
    assert.throws(() => planEntries(commits, [{ hash: 'a', action: 'pick' }, { hash: 'a', action: 'pick' }]), /changed/);
    assert.throws(() => planEntries(commits, [{ hash: 'a', action: 'pick' }, { hash: 'x', action: 'pick' }]), /changed/);
    assert.throws(() => planEntries(commits, [{ hash: 'a', action: 'exec' }, { hash: 'b', action: 'pick' }]), /Unknown action/);
    assert.throws(() => planEntries(commits, [{ hash: 'a', action: 'squash' }, { hash: 'b', action: 'pick' }]), /firstMelts/);
    assert.throws(() => planEntries(commits, [{ hash: 'a', action: 'drop' }, { hash: 'b', action: 'drop' }]), /nothingKept/);
  });
});
