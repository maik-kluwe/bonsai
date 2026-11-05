import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { TestRepo, lines } from './helpers';

const repos: TestRepo[] = [];
const create = (...a: ConstructorParameters<typeof TestRepo>) => { const r = new TestRepo(...a); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

describe('log / head', () => {
  test('head() is undefined in an empty repo, then the HEAD hash', async () => {
    const r = create();
    assert.equal(await r.svc.head(), undefined);
    const h = r.commitFile('a.txt', 'a\n');
    assert.equal(await r.svc.head(), h);
  });

  test('newest first, includes all branches but no stash commits', async () => {
    const r = create();
    const c1 = r.commitFile('a.txt', 'a\n', 'c1');
    r.git('checkout', '-q', '-b', 'feature');
    const c2 = r.commitFile('f.txt', 'f\n', 'c2 feature');
    r.git('checkout', '-q', 'main');
    const c3 = r.commitFile('m.txt', 'm\n', 'c3 main');
    r.write('a.txt', 'geändert\n');
    r.stash('mein stash');

    const log = await r.svc.log(100);
    assert.deepEqual(log.map(c => c.subject), ['c3 main', 'c2 feature', 'c1']);
    assert.deepEqual(log.map(c => c.hash), [c3, c2, c1]);
    assert.deepEqual(log[2].parents, []);
    assert.equal(log[0].author, 'Test');
    assert.equal(log[0].email, 'test@example.com');
  });

  test('a larger limit extends the list without reordering it (paging relies on this)', async () => {
    const r = create();
    for (let i = 1; i <= 6; i++) r.commitFile('a.txt', `${i}\n`, `c${i}`);
    const short = (await r.svc.log(3)).map(c => c.hash);
    const long = (await r.svc.log(6)).map(c => c.hash);
    assert.deepEqual(long.slice(0, 3), short);
    assert.equal(long.length, 6);
  });
});

describe('refs', () => {
  test('branches, tags (annotated points at the commit) and stashes', async () => {
    const r = create();
    const c1 = r.commitFile('a.txt', 'a\n');
    r.git('tag', '-a', 'v1', '-m', 'release');
    r.git('tag', 'leicht');
    r.git('branch', 'feat/x');
    r.write('a.txt', 'x\n');
    r.stash('wip');

    const refs = await r.svc.refs();
    const byName = (n: string) => refs.find(x => x.name === n)!;
    assert.equal(byName('main').kind, 'head');
    assert.equal(byName('feat/x').kind, 'head');
    assert.equal(byName('v1').hash, c1, 'annotated tag points at the commit, not the tag object');
    assert.equal(byName('leicht').hash, c1);
    const stash = refs.find(x => x.kind === 'stash')!;
    assert.equal(stash.index, 0);
    assert.equal(stash.parent, c1);
    assert.equal(stash.name, 'On main: wip');
    assert.equal(stash.label, 'wip', 'the host provides the stash name without the git prefix');
    assert.equal(stash.author, 'Test');
    assert.equal(byName('main').label, undefined, 'only stashes have labels');
  });

  test('ahead/behind against upstream, origin/HEAD stays hidden', async () => {
    const remote = mkdtempSync(path.join(tmpdir(), 'bonsai-remote-'));
    const r = create();
    try {
      const { execFileSync } = await import('child_process');
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
      r.commitFile('a.txt', 'a\n', 'c1');
      r.git('remote', 'add', 'origin', remote);
      r.git('push', '-q', '-u', 'origin', 'main');
      r.git('remote', 'set-head', 'origin', 'main');
      r.commitFile('a.txt', 'b\n', 'c2');
      r.commitFile('a.txt', 'c\n', 'c3');

      const refs = await r.svc.refs();
      const main = refs.find(x => x.name === 'main')!;
      assert.equal(main.upstream, 'origin/main');
      assert.equal(main.ahead, 2);
      assert.equal(main.behind, 0);
      assert.ok(refs.some(x => x.name === 'origin/main' && x.kind === 'remote'));
      assert.ok(!refs.some(x => x.name === 'origin/HEAD'));

      // Someone deletes a branch on the remote; the next fetch with prune removes our remote branch too.
      r.git('push', '-q', '-u', 'origin', 'main:feat');
      r.git('branch', '-q', '--set-upstream-to=origin/feat', 'main');
      assert.equal((await r.svc.refs()).find(x => x.name === 'main')!.gone, false);
      execFileSync('git', ['--git-dir', remote, 'branch', '-q', '-D', 'feat']);
      r.git('fetch', '-q', '--prune');
      const after = (await r.svc.refs()).find(x => x.name === 'main')!;
      assert.equal(after.gone, true);
      assert.equal(after.upstream, 'origin/feat');
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });
});

describe('details', () => {
  test('root commit: files are added (A)', async () => {
    const r = create();
    const c1 = r.commitFile('a.txt', 'a\n');
    const d = await r.svc.details(c1);
    assert.deepEqual(d.files, [{ status: 'A', path: 'a.txt' }]);
    assert.deepEqual(d.parents, []);
  });

  test('rename without changes is R with the old path', async () => {
    const r = create();
    r.commitFile('a.txt', lines(20));
    r.git('mv', 'a.txt', 'neu.txt');
    const c = r.commit('rename');
    assert.deepEqual((await r.svc.details(c)).files, [{ status: 'R', oldPath: 'a.txt', path: 'neu.txt' }]);
  });

  test('paths with spaces and umlauts arrive unchanged (no octal quoting)', async () => {
    const r = create();
    r.commitFile('x.txt', 'x\n');
    const c = r.commitFile('Ordner mit Ümläut/Datei ä ö.txt', 'inhalt\n');
    assert.deepEqual((await r.svc.details(c)).files, [{ status: 'A', path: 'Ordner mit Ümläut/Datei ä ö.txt' }]);
  });

  test('merge commit diffs against the first parent', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    r.git('checkout', '-q', '-b', 'feature');
    r.commitFile('f.txt', 'f\n');
    r.git('checkout', '-q', 'main');
    r.commitFile('m.txt', 'm\n');
    r.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature');
    const [merge] = await r.svc.log(1);
    const d = await r.svc.details(merge.hash);
    assert.deepEqual(d.files.map(f => `${f.status} ${f.path}`), ['A f.txt']);
  });

  test('stash with -u: untracked files (U) come from the 3rd parent and diff against the empty tree', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    r.write('a.txt', 'geändert\n');
    r.write('neu.txt', 'ganz neu\n');
    r.stash('mit untracked', true);
    const [stash] = (await r.svc.refs()).filter(x => x.kind === 'stash');
    const d = await r.svc.details(stash.hash, true);
    assert.equal(d.parents.length, 3);
    const u = d.files.find(f => f.status === 'U')!;
    assert.equal(u.path, 'neu.txt');
    assert.equal(u.base, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    assert.equal(u.target, d.parents[2]);
    assert.ok(d.files.some(f => f.status === 'M' && f.path === 'a.txt'));
  });

  test('subject and body are read separately', async () => {
    const r = create();
    r.write('a.txt', 'a\n');
    const c = r.commit('Betreff\n\nZeile 1\nZeile 2');
    const d = await r.svc.details(c);
    assert.equal(d.subject, 'Betreff');
    assert.equal(d.body, 'Zeile 1\nZeile 2');
    assert.equal(d.hash, c);
  });
});

describe('stashes', () => {
  const setup = (r: TestRepo) => {
    r.commitFile('a.txt', 'a\n');
    for (const n of ['eins', 'zwei', 'drei']) {
      r.write('a.txt', `${n}\n`);
      r.stash(n);
    }
  };

  test('renameStash keeps hash and position, only the text changes, at any place in the list', async () => {
    const cases: [string, [number, string][], string[]][] = [
      ['middle', [[1, 'umbenannt']], ['On main: drei', 'umbenannt', 'On main: eins']],
      ['top and bottom', [[0, 'oben'], [2, 'unten']], ['oben', 'On main: zwei', 'unten']],
    ];
    for (const [name, renames, want] of cases) {
      const r = create();
      setup(r);
      const before = (await r.svc.refs()).filter(x => x.kind === 'stash');
      for (const [index, text] of renames) await r.svc.renameStash(index, text);
      const after = (await r.svc.refs()).filter(x => x.kind === 'stash');
      assert.deepEqual(after.map(s => s.name), want, name);
      assert.deepEqual(after.map(s => s.hash), before.map(s => s.hash), name);
    }
  });

  describe('renameStash aborts midway', () => {
    const stashes = async (r: TestRepo) => (await r.svc.refs()).filter(x => x.kind === 'stash').map(s => [s.name, s.hash]);

    /** Makes the n-th call of `git stash <sub>` fail. */
    const failNth = (r: TestRepo, sub: 'store' | 'drop', n: number) => {
      const run = r.svc.run.bind(r.svc);
      let calls = 0;
      r.svc.run = (args, ...rest) =>
        args[0] === 'stash' && args[1] === sub && ++calls === n ? Promise.reject(new Error(`${sub} failed`)) : run(args, ...rest);
      return () => { r.svc.run = run; };
    };

    for (const [sub, n] of [['store', 1], ['store', 2], ['store', 3], ['drop', 1], ['drop', 2], ['drop', 3]] as const) {
      test(`${sub} #${n} fails: stashes stay unchanged`, async () => {
        const r = create();
        setup(r);
        const before = await stashes(r);
        const restore = failNth(r, sub, n);
        await assert.rejects(r.svc.renameStash(2, 'renamed'), new RegExp(`${sub} failed`));
        restore();
        assert.deepEqual(await stashes(r), before);
      });
    }
  });

  test('applyStashWithIndex restores the index (staged stays staged)', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    r.commitFile('b.txt', 'b\n');
    r.write('a.txt', 'a2\n');
    r.write('b.txt', 'b2\n');
    r.git('add', 'a.txt');
    r.stash('beides');
    assert.deepEqual(r.status(), []);
    await r.svc.applyStashWithIndex(0);
    assert.deepEqual(r.status().sort(), [' M b.txt', 'M  a.txt']);
  });
});

describe('recentMessages / lastCommitMessage', () => {
  test('without merges and duplicates, newest first', async () => {
    const r = create();
    r.commitFile('a.txt', '1\n', 'eins');
    r.commitFile('a.txt', '2\n', 'zwei');
    r.commitFile('a.txt', '3\n', 'eins');
    r.git('checkout', '-q', '-b', 'f');
    r.commitFile('f.txt', 'f\n', 'feature');
    r.git('checkout', '-q', 'main');
    r.commitFile('m.txt', 'm\n', 'main');
    r.git('merge', '-q', '--no-ff', 'f', '-m', 'Merge f');
    assert.deepEqual(await r.svc.recentMessages(10), ['main', 'feature', 'eins', 'zwei']);
  });

  test('prefers own commits (user.email)', async () => {
    const r = create();
    r.commitFile('a.txt', '1\n', 'meiner');
    r.write('a.txt', '2\n');
    r.git('add', '-A');
    r.git('-c', 'user.email=anderer@example.com', '-c', 'user.name=Anderer', 'commit', '-q', '-m', 'fremder');
    assert.deepEqual(await r.svc.recentMessages(10), ['meiner']);
  });

  test('lastCommitMessage returns the full message, "" in an empty repo', async () => {
    const r = create();
    assert.equal(await r.svc.lastCommitMessage(), '');
    r.write('a.txt', 'a\n');
    r.commit('Betreff\n\nBody');
    assert.equal(await r.svc.lastCommitMessage(), 'Betreff\n\nBody');
  });
});
