import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { linesPatch, parseDiff, type ParsedDiff } from '../diff';
import { TestRepo } from './helpers';

const repos: TestRepo[] = [];
const create = () => { const r = new TestRepo(); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

const FILE = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const text = (l: string[]) => l.join('\n') + '\n';

/** a.txt: b -> B, d removed, "new" added after f. Unstaged. */
function setup() {
  const r = create();
  r.commitFile('a.txt', text(FILE), 'base');
  r.write('a.txt', text(['a', 'B', 'c', 'e', 'f', 'new', 'g']));
  return r;
}
const diffOf = (r: TestRepo, file: string, staged: boolean) =>
  parseDiff(r.git('diff', '--no-color', ...(staged ? ['--cached'] : []), '--', file));
const idx = (d: ParsedDiff, t: string, txt: string) => d.hunks[0].lines.findIndex(l => l.t === t && l.text === txt);
const indexContent = (r: TestRepo, file = 'a.txt') => r.git('show', `:${file}`);
const work = (r: TestRepo, file = 'a.txt') => readFileSync(path.join(r.dir, file), 'utf8');
const forward = { cached: true, reverse: false, recount: true };

describe('linesPatch applied by git', () => {
  test('staging only the added line leaves everything else unstaged', async () => {
    const r = setup();
    const d = diffOf(r, 'a.txt', false);
    await r.svc.apply(linesPatch(d, 0, [idx(d, '+', 'new')], 'forward'), forward);
    assert.equal(indexContent(r), text(['a', 'b', 'c', 'd', 'e', 'f', 'new', 'g']));
    assert.equal(r.git('show', 'HEAD:a.txt'), text(FILE));
  });

  test('staging one half of a replacement stages the removal but not the addition', async () => {
    const r = setup();
    const d = diffOf(r, 'a.txt', false);
    await r.svc.apply(linesPatch(d, 0, [idx(d, '-', 'b')], 'forward'), forward);
    assert.equal(indexContent(r), text(['a', 'c', 'd', 'e', 'f', 'g']));
  });

  test('staging every changed line equals staging the hunk', async () => {
    const r = setup();
    const d = diffOf(r, 'a.txt', false);
    const all = d.hunks[0].lines.map((l, i) => (l.t === '+' || l.t === '-' ? i : -1)).filter(i => i >= 0);
    await r.svc.apply(linesPatch(d, 0, all, 'forward'), forward);
    assert.equal(indexContent(r), text(['a', 'B', 'c', 'e', 'f', 'new', 'g']));
    assert.deepEqual(r.status(), ['M  a.txt']);
  });

  test('non-contiguous lines of one hunk can be staged together', async () => {
    const r = setup();
    const d = diffOf(r, 'a.txt', false);
    await r.svc.apply(linesPatch(d, 0, [idx(d, '-', 'd'), idx(d, '+', 'new')], 'forward'), forward);
    assert.equal(indexContent(r), text(['a', 'b', 'c', 'e', 'f', 'new', 'g']));
  });

  test('unstaging one line takes only that line out of the index', async () => {
    const r = setup();
    r.git('add', 'a.txt');
    const d = diffOf(r, 'a.txt', true);
    await r.svc.apply(linesPatch(d, 0, [idx(d, '+', 'new')], 'reverse'), { cached: true, reverse: true, recount: true });
    assert.equal(indexContent(r), text(['a', 'B', 'c', 'e', 'f', 'g']));
    assert.equal(work(r), text(['a', 'B', 'c', 'e', 'f', 'new', 'g']), 'working copy untouched');
  });

  test('discarding one line restores it in the working copy only', async () => {
    const r = setup();
    const d = diffOf(r, 'a.txt', false);
    await r.svc.apply(linesPatch(d, 0, [idx(d, '-', 'd')], 'reverse'), { cached: false, reverse: true, recount: true });
    assert.equal(work(r), text(['a', 'B', 'c', 'd', 'e', 'f', 'new', 'g']));
    assert.equal(indexContent(r), text(FILE));
  });

  test('staging lines in two steps ends where staging the hunk would', async () => {
    const r = setup();
    for (const [t, txt] of [['-', 'd'], ['+', 'new']] as const) {
      const d = diffOf(r, 'a.txt', false);
      await r.svc.apply(linesPatch(d, 0, [idx(d, t, txt)], 'forward'), forward);
    }
    assert.equal(indexContent(r), text(['a', 'b', 'c', 'e', 'f', 'new', 'g']));
  });

  describe('without context lines, a line with no counterpart lands in its place', () => {
    const zero = (r: TestRepo, staged = false) =>
      parseDiff(r.git('diff', '--no-color', '-U0', ...(staged ? ['--cached'] : []), '--', 'a.txt'));
    const withoutLine = (i: number) => FILE.filter((_, k) => k !== i);
    const back = { cached: false, reverse: true, recount: true };

    for (const [where, i] of [['first', 0], ['middle', 3], ['last', 6]] as const) {
      test(`discarding the removal of the ${where} line`, async () => {
        const r = create();
        r.commitFile('a.txt', text(FILE), 'base');
        r.write('a.txt', text(withoutLine(i)));
        const d = zero(r);
        await r.svc.apply(linesPatch(d, 0, [0], 'reverse'), back);
        assert.equal(work(r), text(FILE));
      });

      test(`staging the ${where} line as an addition`, async () => {
        const r = create();
        r.commitFile('a.txt', text(withoutLine(i)), 'base');
        r.write('a.txt', text(FILE));
        const d = zero(r);
        await r.svc.apply(linesPatch(d, 0, [0], 'forward'), forward);
        assert.equal(indexContent(r), text(FILE));
      });

      test(`unstaging the removal of the ${where} line`, async () => {
        const r = create();
        r.commitFile('a.txt', text(FILE), 'base');
        r.write('a.txt', text(withoutLine(i)));
        r.git('add', 'a.txt');
        const d = zero(r, true);
        await r.svc.apply(linesPatch(d, 0, [0], 'reverse'), { cached: true, reverse: true, recount: true });
        assert.equal(indexContent(r), text(FILE));
      });
    }

    test('one of two removed lines goes back between its neighbours', async () => {
      const r = create();
      r.commitFile('a.txt', text(FILE), 'base');
      r.write('a.txt', text(['a', 'b', 'e', 'f', 'g']));
      const d = zero(r);
      await r.svc.apply(linesPatch(d, 0, [1], 'reverse'), back);
      assert.equal(work(r), text(['a', 'b', 'd', 'e', 'f', 'g']));
    });
  });

  test('context and header lines in the selection are ignored; nothing selected is refused', () => {
    const d = diffOf(setup(), 'a.txt', false);
    assert.throws(() => linesPatch(d, 0, [0], 'forward'), /No changed line/);
    assert.throws(() => linesPatch(d, 0, [], 'forward'), /No changed line/);
    assert.throws(() => linesPatch(d, 5, [0], 'forward'), /Hunk not found/);
  });

  test('CRLF files keep their line endings', async () => {
    const r = create();
    r.commitFile('w.txt', 'a\r\nb\r\nc\r\n', 'base');
    r.write('w.txt', 'a\r\nB\r\nc\r\nd\r\n');
    const d = diffOf(r, 'w.txt', false);
    await r.svc.apply(linesPatch(d, 0, [idx(d, '+', 'd\r')], 'forward'), forward);
    assert.equal(indexContent(r, 'w.txt'), 'a\r\nb\r\nc\r\nd\r\n');
  });

  test('a missing newline at the end of the file works when the marker follows a chosen line', async () => {
    const r = create();
    r.commitFile('n.txt', 'one\ntwo\nthree', 'base');
    r.write('n.txt', 'ONE\ntwo\nthree\nfour');
    const d = diffOf(r, 'n.txt', false);
    const i = d.hunks[0].lines.findIndex(l => l.t === '-' && l.text === 'one');
    await r.svc.apply(linesPatch(d, 0, [i], 'forward'), forward);
    assert.equal(indexContent(r, 'n.txt'), 'two\nthree');
  });

  test('added and deleted files are refused', () => {
    const r = create();
    r.commitFile('x.txt', 'x\n', 'base');
    r.write('new.txt', 'n\n');
    r.git('add', 'new.txt');
    const d = diffOf(r, 'new.txt', true);
    assert.throws(() => linesPatch(d, 0, [0], 'reverse'), /added or deleted files/);
  });
});
