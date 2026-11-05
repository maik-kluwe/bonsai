import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { GitService } from '../gitService';
import type { Repository } from '../git';
import { TestRepo, lines } from './helpers';

// media/ is outside src/ (rootDir), hence require; at runtime: out/test → ../../media
const { createResolution } = require('../../media/mergeresolve.js');

const repos: TestRepo[] = [];
const create = (...a: ConstructorParameters<typeof TestRepo>) => { const r = new TestRepo(...a); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

const BASE = ['eins', 'zwei', 'drei', 'vier', 'fuenf'];
const text = (l: string[], eol = '\n') => l.join(eol) + eol;
const swap = (l: string[], at: Record<string, string>) => l.map(x => at[x] ?? x);
const read = (r: TestRepo, rel: string) => readFileSync(path.join(r.dir, rel), 'utf8');
const hasConflicts = (r: TestRepo) => r.status().some(l => /^(U.|.U|AA|DD)/.test(l));

/**
 * k.txt: conflict in "zwei"; "fuenf" only changes in theirs → git merges it itself.
 */
function conflict(r: TestRepo, eol = '\n') {
  r.commitFile('k.txt', text(BASE, eol), 'base k');
  r.git('checkout', '-q', '-b', 'theirs');
  r.write('k.txt', text(swap(BASE, { zwei: 'THEIRS zwei', fuenf: 'THEIRS fuenf' }), eol));
  r.commit('theirs aendert');
  r.git('checkout', '-q', 'main');
  r.write('k.txt', text(swap(BASE, { zwei: 'OURS zwei' }), eol));
  r.commit('ours aendert');
  const m = r.tryGit('merge', 'theirs');
  assert.equal(m.code, 1, m.out);
}

describe('mergeState', () => {
  test('during a merge: name of the other side, hash and message without # comments', async () => {
    const r = create();
    conflict(r);
    const s = (await r.svc.mergeState())!;
    assert.equal(s.theirs, 'theirs');
    assert.equal(s.hash, r.git('rev-parse', 'MERGE_HEAD').trim());
    assert.equal(s.message.split('\n')[0], "Merge branch 'theirs'");
    assert.ok(!s.message.split('\n').some(l => l.startsWith('#')));
  });

  test('starts no Git process when nothing is running', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    const started: string[][] = [];
    const svc = new GitService('git', { rootUri: { fsPath: r.dir } } as unknown as Repository, args => started.push(args));
    assert.equal(await svc.mergeState(), undefined);
    assert.deepEqual(started, []);
  });

  test('a linked worktree has its own state, found through the .git file', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    const wt = path.join(r.dir, 'wt');
    r.git('worktree', 'add', '-q', '-b', 'side', wt);
    const inWt = (...args: string[]) => execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8', stdio: 'pipe' });
    writeFileSync(path.join(wt, 'a.txt'), 'side\n');
    inWt('commit', '-qam', 'side');
    r.write('a.txt', 'main\n');
    r.commit('main');
    assert.throws(() => inWt('merge', 'main'));
    const svc = new GitService('git', { rootUri: { fsPath: wt } } as unknown as Repository);
    assert.equal((await svc.mergeState())?.kind, 'merge');
    assert.equal(await r.svc.mergeState(), undefined);
  });

  test('a reftable repository keeps the markers out of the files', async () => {
    const r = create();
    const rt = path.join(r.dir, 'rt');
    r.git('init', '-q', '-b', 'main', '--ref-format=reftable', rt);
    const inRt = (...args: string[]) => execFileSync('git', ['-C', rt, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8', stdio: 'pipe' });
    const commit = (text: string) => { writeFileSync(path.join(rt, 'a.txt'), text); inRt('add', '.'); inRt('commit', '-qm', text.trim()); };
    commit('base\n');
    inRt('checkout', '-q', '-b', 'side');
    commit('side\n');
    inRt('checkout', '-q', 'main');
    commit('main\n');
    assert.throws(() => inRt('cherry-pick', 'side'));
    const svc = new GitService('git', { rootUri: { fsPath: rt } } as unknown as Repository);
    assert.equal((await svc.mergeState())?.kind, 'cherryPick');
  });

  test('branch with a slash in its name', async () => {
    const r = create();
    r.commitFile('k.txt', text(BASE));
    r.git('checkout', '-q', '-b', 'feat/x');
    r.commitFile('k.txt', text(swap(BASE, { zwei: 'X' })));
    r.git('checkout', '-q', 'main');
    r.commitFile('k.txt', text(swap(BASE, { zwei: 'M' })));
    r.tryGit('merge', 'feat/x');
    assert.equal((await r.svc.mergeState())!.theirs, 'feat/x');
  });
});

describe('conflictSides', () => {
  test('says what each side did, with commit info', async () => {
    const r = create();
    conflict(r);
    const s = await r.svc.conflictSides('k.txt', (await r.svc.mergeState())!.hash);
    assert.equal(s.ours.change, 'modified', 'both change');
    assert.equal(s.theirs.change, 'modified', 'both change');
    assert.equal(s.ours.subject, 'ours aendert', 'both change');
    assert.equal(s.theirs.subject, 'theirs aendert', 'both change');
    assert.match(s.ours.hash!, /^[0-9a-f]{7,}$/, 'both change');

    const d = create();
    d.commitFile('k.txt', text(BASE));
    d.git('checkout', '-q', '-b', 'theirs');
    d.git('rm', '-q', 'k.txt');
    d.commit('theirs loescht');
    d.git('checkout', '-q', 'main');
    d.commitFile('k.txt', text(swap(BASE, { zwei: 'OURS' })), 'ours aendert');
    d.tryGit('merge', 'theirs');
    const del = await d.svc.conflictSides('k.txt', (await d.svc.mergeState())!.hash);
    assert.equal(del.ours.change, 'modified', 'one side deletes');
    assert.equal(del.theirs.change, 'deleted', 'one side deletes');

    const a = create();
    a.commitFile('x.txt', 'x\n');
    a.git('checkout', '-q', '-b', 'theirs');
    a.commitFile('neu.txt', 'theirs\n');
    a.git('checkout', '-q', 'main');
    a.commitFile('neu.txt', 'ours\n');
    a.tryGit('merge', 'theirs');
    const added = await a.svc.conflictSides('neu.txt', (await a.svc.mergeState())!.hash);
    assert.equal(added.ours.change, 'added', 'both add the same file');
    assert.equal(added.theirs.change, 'added', 'both add the same file');
  });
});

describe('resolveUsing', () => {
  test('ours or theirs: the file has that version and is staged', async () => {
    for (const [side, want, gone] of [['ours', 'OURS zwei', 'THEIRS zwei'], ['theirs', 'THEIRS zwei', 'OURS zwei']] as const) {
      const r = create();
      conflict(r);
      await r.svc.resolveUsing(['k.txt'], side);
      assert.ok(!hasConflicts(r), side);
      assert.ok(read(r, 'k.txt').includes(want), side);
      assert.ok(!read(r, 'k.txt').includes(gone), side);
      assert.ok(!read(r, 'k.txt').includes('<<<<<<<'), side);
    }
  });

  test('side deleted the file: theirs removes it, ours keeps it', async () => {
    const make = () => {
      const r = create();
      r.commitFile('k.txt', text(BASE));
      r.git('checkout', '-q', '-b', 'theirs');
      r.git('rm', '-q', 'k.txt');
      r.commit('theirs loescht');
      r.git('checkout', '-q', 'main');
      r.commitFile('k.txt', text(swap(BASE, { zwei: 'OURS' })));
      r.tryGit('merge', 'theirs');
      return r;
    };
    const a = make();
    await a.svc.resolveUsing(['k.txt'], 'theirs');
    assert.ok(!hasConflicts(a));
    assert.ok(!existsSync(path.join(a.dir, 'k.txt')));
    const b = make();
    await b.svc.resolveUsing(['k.txt'], 'ours');
    assert.ok(!hasConflicts(b));
    assert.ok(read(b, 'k.txt').includes('OURS'));
  });

  test('multiple files in one call, path with spaces and umlauts', async () => {
    const r = create();
    const f1 = 'Ordner mit Ümläut/Datei ä ö.txt', f2 = 'zwei.txt';
    r.commitFile(f1, text(BASE));
    r.commitFile(f2, text(BASE));
    r.git('checkout', '-q', '-b', 'theirs');
    r.write(f1, text(swap(BASE, { zwei: 'T' })));
    r.write(f2, text(swap(BASE, { zwei: 'T' })));
    r.commit('theirs');
    r.git('checkout', '-q', 'main');
    r.write(f1, text(swap(BASE, { zwei: 'O' })));
    r.write(f2, text(swap(BASE, { zwei: 'O' })));
    r.commit('ours');
    r.tryGit('merge', 'theirs');
    assert.ok(hasConflicts(r));
    await r.svc.resolveUsing([f1, f2], 'theirs');
    assert.ok(!hasConflicts(r));
    assert.ok(read(r, f1).includes('T') && read(r, f2).includes('T'));
  });
});

describe('mergeInputs', () => {
  test('conflict block with base; undisputed parts are already merged', async () => {
    const r = create();
    conflict(r);
    const m = await r.svc.mergeInputs('k.txt');
    assert.ok(m.ok);
    if (!m.ok) return;
    assert.equal(m.eol, '\n');
    assert.equal(m.finalNewline, true);
    assert.deepEqual(m.segments, [
      { t: 'text', lines: ['eins'] },
      { t: 'conflict', ours: ['OURS zwei'], base: ['zwei'], theirs: ['THEIRS zwei'] },
      { t: 'text', lines: ['drei', 'vier', 'THEIRS fuenf'] },
    ]);
  });

  test('detects CRLF and missing trailing newline', async () => {
    const r = create();
    r.commitFile('k.txt', 'eins\r\nzwei\r\ndrei', 'base');
    r.git('checkout', '-q', '-b', 'theirs');
    r.commitFile('k.txt', 'eins\r\nTHEIRS\r\ndrei', 'theirs');
    r.git('checkout', '-q', 'main');
    r.commitFile('k.txt', 'eins\r\nOURS\r\ndrei', 'ours');
    r.tryGit('merge', 'theirs');
    const m = await r.svc.mergeInputs('k.txt');
    assert.ok(m.ok);
    if (!m.ok) return;
    assert.equal(m.eol, '\r\n');
    assert.equal(m.finalNewline, false);
    assert.deepEqual(m.segments[1], { t: 'conflict', ours: ['OURS'], base: ['zwei'], theirs: ['THEIRS'] });
  });

  test('both add the same file (no base)', async () => {
    const r = create();
    r.commitFile('x.txt', 'x\n');
    r.git('checkout', '-q', '-b', 'theirs');
    r.commitFile('neu.txt', 'theirs\n');
    r.git('checkout', '-q', 'main');
    r.commitFile('neu.txt', 'ours\n');
    r.tryGit('merge', 'theirs');
    const m = await r.svc.mergeInputs('neu.txt');
    assert.ok(m.ok);
    if (!m.ok) return;
    assert.deepEqual(m.segments, [{ t: 'conflict', ours: ['ours'], base: [], theirs: ['theirs'] }]);
  });

  test('names the reason it cannot help: deleted, binary, Latin-1 instead of corrupted characters, very large', async () => {
    const d = create();
    d.commitFile('k.txt', text(BASE));
    d.git('checkout', '-q', '-b', 'theirs');
    d.git('rm', '-q', 'k.txt');
    d.commit('theirs loescht');
    d.git('checkout', '-q', 'main');
    d.commitFile('k.txt', text(swap(BASE, { zwei: 'OURS' })));
    d.tryGit('merge', 'theirs');
    assert.deepEqual(await d.svc.mergeInputs('k.txt'), { ok: false, reason: 'deleted' }, 'deleted');

    const latin = (s: string) => Buffer.from(s, 'latin1');
    const big = (mid: string) => lines(5001).replace('\n2500\n', `\n${mid}\n`);
    const cases: [string, string, string | Buffer, string | Buffer, string | Buffer, string][] = [
      ['binary', 'b.bin', Buffer.from([0, 1, 2, 3]), Buffer.from([0, 9, 9, 9]), Buffer.from([0, 7, 7, 7]), 'binary'],
      ['Latin-1', 'l.txt', latin('eins\nzwei\ndrei\n'), latin('eins\nT \xe4\ndrei\n'), latin('eins\nO \xf6\ndrei\n'), 'binary'],
      ['very large', 'big.txt', lines(5001), big('T'), big('O'), 'large'],
    ];
    for (const [name, file, base, theirs, ours, reason] of cases) {
      const r = create();
      r.commitFile(file, base);
      r.git('checkout', '-q', '-b', 'theirs');
      r.commitFile(file, theirs);
      r.git('checkout', '-q', 'main');
      r.commitFile(file, ours);
      r.tryGit('merge', 'theirs');
      assert.deepEqual(await r.svc.mergeInputs(file), { ok: false, reason }, name);
    }
  });

  test('umlauts and BOM in the content are preserved', async () => {
    const r = create();
    r.commitFile('u.txt', '﻿Über\nzwei\ndrei\n');
    r.git('checkout', '-q', '-b', 'theirs');
    r.commitFile('u.txt', '﻿Über\nTHEIRS ß\ndrei\n');
    r.git('checkout', '-q', 'main');
    r.commitFile('u.txt', '﻿Über\nOURS ä\ndrei\n');
    r.tryGit('merge', 'theirs');
    const m = await r.svc.mergeInputs('u.txt');
    assert.ok(m.ok);
    if (!m.ok) return;
    assert.deepEqual(m.segments[0], { t: 'text', lines: ['﻿Über'] });
    assert.deepEqual(m.segments[1], { t: 'conflict', ours: ['OURS ä'], base: ['zwei'], theirs: ['THEIRS ß'] });
  });
});

describe('writeResolved', () => {
  test('rejects paths outside the repo', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    await assert.rejects(r.svc.writeResolved('../ausserhalb.txt', 'x'), /Invalid path/);
    await assert.rejects(r.svc.writeResolved('sub/../../ausserhalb.txt', 'x'), /Invalid path/);
  });

  test('full flow: dialog data → pick both sides → merge commit', async () => {
    const r = create();
    conflict(r);
    const m = await r.svc.mergeInputs('k.txt');
    assert.ok(m.ok);
    if (!m.ok) return;
    // Selection as in the dialog: both sides, theirs first, then ours
    const res = createResolution(m.segments, { eol: m.eol, finalNewline: m.finalNewline, ours: 'main', theirs: 'theirs' });
    res.takeAll('theirs', true);
    res.takeAll('ours', true);
    assert.ok(res.canResolve());
    await r.svc.writeResolved('k.txt', res.content());
    assert.equal(read(r, 'k.txt'), 'eins\nTHEIRS zwei\nOURS zwei\ndrei\nvier\nTHEIRS fuenf\n');
    assert.equal(await r.svc.mergeState().then(s => s?.theirs), 'theirs');
    r.git('commit', '-q', '--no-edit');
    assert.equal(await r.svc.mergeState(), undefined);
    const [head] = await r.svc.log(1);
    assert.equal(head.parents.length, 2);
  });
});
