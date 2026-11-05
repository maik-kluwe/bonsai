import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { hunkPatch, parseDiff } from '../diff';
import { TestRepo, lines } from './helpers';

const repos: TestRepo[] = [];
const create = (...a: ConstructorParameters<typeof TestRepo>) => { const r = new TestRepo(...a); repos.push(r); return r; };
afterEach(() => { while (repos.length) repos.pop()!.dispose(); });

/** Changed lines of the index (staged) or working copy as "-old"/"+new", without line-ending noise. */
const changed = (r: TestRepo, staged: boolean, file: string) =>
  r.git('diff', '--unified=0', ...(staged ? ['--cached'] : []), '--', file).split('\n')
    .filter(l => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l)).map(l => l.replace(/\r$/, ''));

const hunkOf = async (r: TestRepo, file: string, staged: boolean, index: number) =>
  hunkPatch(parseDiff(await r.svc.diffLocal(file, staged, false)), index);

/** nums.txt with 40 lines; lines 3 and 35 changed → two separate hunks. */
function twoHunks(r: TestRepo, eol: string, file = 'nums.txt') {
  r.commitFile(file, lines(40, eol));
  const edited = lines(40, eol).split(eol).map(l => l === '3' ? 'DREI' : l === '35' ? 'FUENFUNDDREISSIG' : l).join(eol);
  r.write(file, edited);
}

for (const autocrlf of ['false', 'true', 'input'] as const) {
  for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n']] as const) {
    test(`hunk staging · core.autocrlf=${autocrlf} · ${name} file: stage, unstage and discard take only the chosen hunk`, async () => {
      const stage = create({ autocrlf });
      twoHunks(stage, eol);
      await stage.svc.apply(await hunkOf(stage, 'nums.txt', false, 0), { cached: true, reverse: false });
      assert.deepEqual(changed(stage, true, 'nums.txt'), ['-3', '+DREI'], 'stage');
      assert.deepEqual(changed(stage, false, 'nums.txt'), ['-35', '+FUENFUNDDREISSIG'], 'stage');

      const unstage = create({ autocrlf });
      twoHunks(unstage, eol);
      unstage.git('add', 'nums.txt');
      await unstage.svc.apply(await hunkOf(unstage, 'nums.txt', true, 0), { cached: true, reverse: true });
      assert.deepEqual(changed(unstage, true, 'nums.txt'), ['-35', '+FUENFUNDDREISSIG'], 'unstage');
      assert.deepEqual(changed(unstage, false, 'nums.txt'), ['-3', '+DREI'], 'unstage');

      const discard = create({ autocrlf });
      twoHunks(discard, eol);
      await discard.svc.apply(await hunkOf(discard, 'nums.txt', false, 0), { cached: false, reverse: true });
      assert.deepEqual(changed(discard, false, 'nums.txt'), ['-35', '+FUENFUNDDREISSIG'], 'discard');
      assert.deepEqual(changed(discard, true, 'nums.txt'), [], 'discard');
    });
  }
}

describe('hunk staging · special cases', () => {
  test('paths with spaces and umlauts, octal-quoted by git or not', async () => {
    const quoted = create();
    const file = 'Ordner mit Ümläut/Datei ä ö.txt';
    twoHunks(quoted, '\n', file);
    await quoted.svc.apply(await hunkOf(quoted, file, false, 0), { cached: true, reverse: false });
    assert.deepEqual(changed(quoted, true, file), ['-3', '+DREI'], 'quoted');
    assert.deepEqual(changed(quoted, false, file), ['-35', '+FUENFUNDDREISSIG'], 'quoted');

    const plain = create();
    plain.git('config', 'core.quotepath', 'false');
    const other = 'Größe ß/Ärger.txt';
    twoHunks(plain, '\n', other);
    await plain.svc.apply(await hunkOf(plain, other, false, 1), { cached: true, reverse: false });
    assert.deepEqual(changed(plain, true, other), ['-35', '+FUENFUNDDREISSIG'], 'core.quotepath=false');
  });

  test('file without trailing newline', async () => {
    const r = create();
    r.commitFile('a.txt', 'eins\nzwei');
    r.write('a.txt', 'EINS\nzwei');
    await r.svc.apply(await hunkOf(r, 'a.txt', false, 0), { cached: true, reverse: false });
    assert.deepEqual(changed(r, true, 'a.txt'), ['-eins', '+EINS']);
  });

  test('untracked file: diff against /dev/null shows all lines as added', async () => {
    const r = create();
    r.commitFile('a.txt', 'a\n');
    r.write('Neue Datei ß.txt', 'x\ny\n');
    const d = parseDiff(await r.svc.diffLocal('Neue Datei ß.txt', false, true));
    assert.equal(d.hunks.length, 1);
    assert.deepEqual(d.hunks[0].lines.map(l => [l.t, l.text]), [['+', 'x'], ['+', 'y']]);
  });
});
