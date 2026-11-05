import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { checkHunk, hunkBody, hunkPatch, parseDiff } from '../diff';

const TWO_HUNKS = [
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,3 @@ erste',
  ' a',
  '-b',
  '+B',
  ' c',
  '@@ -10,2 +10,3 @@ zweite',
  ' x',
  '+neu',
  ' y',
  '',
].join('\n');

describe('parseDiff', () => {
  test('separates file header and hunks', () => {
    const d = parseDiff(TWO_HUNKS);
    assert.equal(d.fileHeader.length, 4);
    assert.equal(d.hunks.length, 2);
    assert.equal(d.hunks[0].header, '@@ -1,3 +1,3 @@ erste');
    assert.equal(d.binary, false);
  });

  test('counts old and new line numbers', () => {
    const [h1, h2] = parseDiff(TWO_HUNKS).hunks;
    assert.deepEqual(h1.lines.map(l => [l.t, l.o, l.n]), [[' ', 1, 1], ['-', 2, undefined], ['+', undefined, 2], [' ', 3, 3]]);
    assert.deepEqual(h2.lines.map(l => [l.t, l.o, l.n]), [[' ', 10, 10], ['+', undefined, 11], [' ', 11, 12]]);
  });

  test('hunk header without length ("@@ -1 +1 @@")', () => {
    const d = parseDiff('--- a/f\n+++ b/f\n@@ -5 +7 @@\n-a\n+b\n');
    assert.deepEqual(d.hunks[0].lines.map(l => [l.o, l.n]), [[5, undefined], [undefined, 7]]);
  });

  test('"No newline at end of file" stays its own line and is not counted', () => {
    const d = parseDiff('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n');
    assert.deepEqual(d.hunks[0].lines.map(l => l.t), ['-', '\\', '+']);
    assert.equal(d.hunks[0].lines[2].n, 1);
  });

  test('detects binary files', () => {
    assert.equal(parseDiff('diff --git a/x.bin b/x.bin\nBinary files a/x.bin and b/x.bin differ\n').binary, true);
    assert.equal(parseDiff('diff --git a/x.bin b/x.bin\nGIT binary patch\nliteral 3\n').binary, true);
  });

  test('CRLF lines keep their "\\r" (needed for git apply)', () => {
    const d = parseDiff('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\r\n+b\r\n');
    assert.equal(d.hunks[0].lines[0].text, 'a\r');
    assert.equal(d.hunks[0].raw[1], '-a\r');
  });
});

describe('checkHunk', () => {
  const diffAt = (line: number, added = 'new') => parseDiff(['diff --git a/f b/f', '--- a/f', '+++ b/f', `@@ -${line},2 +${line},2 @@`, ' same', '-old', `+${added}`].join('\n'));

  test('the body is what the hunk says, without its position', () => {
    assert.deepEqual(hunkBody(diffAt(1).hunks[0]), [' same', '-old', '+new']);
  });

  test('a hunk that only moved is still the same hunk', () => {
    assert.doesNotThrow(() => checkHunk(diffAt(40), 0, hunkBody(diffAt(1).hunks[0])));
  });

  test('another text at that position, or no hunk there, is refused', () => {
    const body = hunkBody(diffAt(1).hunks[0]);
    assert.throws(() => checkHunk(diffAt(1, 'other'), 0, body), /the diff has changed/);
    assert.throws(() => checkHunk(diffAt(1), 1, body), /the diff has changed/);
  });
});

describe('hunkPatch', () => {
  test('contains the file header and exactly the chosen hunk', () => {
    const d = parseDiff(TWO_HUNKS);
    const p = hunkPatch(d, 1);
    assert.ok(p.startsWith('diff --git a/f.txt b/f.txt\n'));
    assert.ok(p.includes('@@ -10,2 +10,3 @@ zweite'));
    assert.ok(!p.includes('@@ -1,3 +1,3 @@'));
    assert.ok(!p.includes('+B'));
    assert.ok(p.endsWith('\n'));
  });

  test('throws for an unknown hunk (diff has changed)', () => {
    assert.throws(() => hunkPatch(parseDiff(TWO_HUNKS), 5), /Hunk/);
  });
});
