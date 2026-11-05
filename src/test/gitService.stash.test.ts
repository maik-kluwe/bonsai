import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { existsSync, readFileSync, rmSync } from 'fs';
import * as path from 'path';
import { TestRepo } from './helpers';

const repos: TestRepo[] = [];
const create = () => { const r = new TestRepo(); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

const status = (r: TestRepo) => r.git('status', '--short').split('\n').filter(Boolean).map(l => l.replace(/\r$/, ''));
const has = (r: TestRepo, file: string) => existsSync(path.join(r.dir, file));
const read = (r: TestRepo, file: string) => readFileSync(path.join(r.dir, file), 'utf8');

describe('stash chosen files', () => {
  test('only the chosen files go; the others stay as they were, staged or not', async () => {
    const r = create();
    for (const f of ['a.txt', 'b.txt', 'c.txt']) r.commitFile(f, 'old\n');
    r.write('a.txt', 'new\n'); r.git('add', 'a.txt');
    r.write('b.txt', 'new\n'); r.git('add', 'b.txt');
    r.write('c.txt', 'new\n');
    await r.svc.stashFiles(['a.txt'], 'just a');
    assert.deepEqual(status(r), ['M  b.txt', ' M c.txt']);
    assert.equal(read(r, 'a.txt'), 'old\n');
    assert.match(r.git('stash', 'list'), /On main: just a/);
  });

  test('a new file comes back as it was: untracked', async () => {
    const r = create();
    r.commitFile('a.txt', 'old\n');
    r.write('new.txt', 'new\n');
    r.write('other.txt', 'stays\n');
    await r.svc.stashFiles(['new.txt'], 'new one');
    assert.equal(has(r, 'new.txt'), false);
    assert.deepEqual(status(r), ['?? other.txt']);
    r.git('stash', 'pop');
    assert.deepEqual(status(r), ['?? new.txt', '?? other.txt']);
  });

  test('deletions, staged and unstaged', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    r.commitFile('b.txt', 'b\n');
    r.git('rm', '-q', 'a.txt');
    rmSync(path.join(r.dir, 'b.txt'));
    await r.svc.stashFiles(['a.txt', 'b.txt'], 'gone');
    assert.deepEqual(status(r), []);
    assert.equal(read(r, 'a.txt'), 'a\n');
    assert.equal(read(r, 'b.txt'), 'b\n');
  });

  test('a rename goes as a whole when both of its paths are given', async () => {
    const r = create();
    r.commitFile('old.txt', 'content\n');
    r.git('mv', 'old.txt', 'new.txt');
    await r.svc.stashFiles(['new.txt', 'old.txt'], 'moved');
    assert.deepEqual(status(r), []);
    assert.equal(has(r, 'old.txt'), true);
    assert.equal(has(r, 'new.txt'), false);
  });

  test('names with spaces and pathspec characters mean only that file', async () => {
    const r = create();
    for (const f of ['a[1].txt', 'a1.txt', 'with space.txt']) r.commitFile(f, 'old\n');
    for (const f of ['a[1].txt', 'a1.txt', 'with space.txt']) r.write(f, 'new\n');
    await r.svc.stashFiles(['a[1].txt', 'with space.txt'], 'odd names');
    assert.deepEqual(status(r), [' M a1.txt']);
  });

  test('when Git refuses, nothing changed: no stash, and a staged deletion is staged again', async () => {
    const r = create();
    r.commitFile('a.txt', 'base\n');
    r.commitFile('gone.txt', 'gone\n');
    r.git('checkout', '-q', '-b', 'other');
    r.commitFile('a.txt', 'theirs\n');
    r.git('checkout', '-q', 'main');
    r.commitFile('a.txt', 'ours\n');
    r.tryGit('merge', 'other');
    r.git('rm', '-q', 'gone.txt');
    await assert.rejects(r.svc.stashFiles(['a.txt', 'gone.txt'], 'refused'));
    assert.equal(r.git('stash', 'list'), '');
    assert.deepEqual(status(r), ['UU a.txt', 'D  gone.txt']);
  });

  test('no paths: nothing happens, Git must not stash everything', async () => {
    const r = create();
    r.commitFile('a.txt', 'old\n');
    r.write('a.txt', 'new\n');
    await r.svc.stashFiles([], 'nothing');
    assert.deepEqual(status(r), [' M a.txt']);
    assert.equal(r.git('stash', 'list'), '');
  });
});
