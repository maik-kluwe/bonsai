import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { imageMime, imageSide, MAX_IMAGE_BYTES, readImages, refSource } from '../images';
import { EMPTY_TREE } from '../diffTargets';
import type { GitService } from '../gitService';
import { TestRepo } from './helpers';
import { png } from './png';

const { formatBytes, percentAt, fitScale }: { formatBytes(n: number, locale?: string): string; percentAt(x: number, left: number, width: number): number; fitScale(widths: number[], mode: string, available: number): number } = require('../../media/imagediff.js');

describe('which files are pictures', () => {
  test('png, jpg and the other raster formats by extension, in any case; SVG and the rest are not', () => {
    assert.equal(imageMime('a/b/Logo.PNG'), 'image/png');
    assert.equal(imageMime('x.jpeg'), 'image/jpeg');
    assert.equal(imageMime('x.webp'), 'image/webp');
    assert.equal(imageMime('x.svg'), undefined, 'Git diffs SVG as text, that diff stays');
    assert.equal(imageMime('png'), undefined);
  });

  test('a side is a data URL, only up to the limit; nothing stays nothing', () => {
    assert.equal(imageSide(undefined, 'image/png'), undefined);
    assert.deepEqual(imageSide(Buffer.from('ab'), 'image/png'), { bytes: 2, url: 'data:image/png;base64,YWI=' });
    assert.deepEqual(imageSide(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'), { bytes: MAX_IMAGE_BYTES + 1 });
  });

  test('the empty tree has no file', () => {
    assert.equal(refSource(EMPTY_TREE, 'a.png'), undefined);
    assert.deepEqual(refSource('abc', 'a.png'), { kind: 'rev', rev: 'abc', file: 'a.png' });
  });
});

describe('the numbers of the view', () => {
  test('sizes read like in Fork', () => {
    assert.equal(formatBytes(609, 'en'), '609 Bytes');
    assert.equal(formatBytes(1468, 'en'), '1.43 KB');
    assert.equal(formatBytes(1468, 'de'), '1,43 KB');
    assert.equal(formatBytes(3 * 1024 * 1024, 'en'), '3 MB');
  });

  test('the swipe line stays inside the picture', () => {
    assert.equal(percentAt(150, 100, 200), 25);
    assert.equal(percentAt(0, 100, 200), 0);
    assert.equal(percentAt(900, 100, 200), 100);
    assert.equal(percentAt(5, 0, 0), 50, 'nothing drawn yet');
  });
});

describe('fitting pictures into the room they have', () => {
  test('side by side both shrink by one factor, after the frames and the gap are taken off', () => {
    // 300 + 360 pixels of picture, 2 frames of 16 and a gap of 32: 64 pixels that do not shrink
    assert.equal(fitScale([300, 360], 'side', 724), 1, 'exactly enough room');
    assert.equal(fitScale([300, 360], 'side', 1000), 1, 'never larger than they are');
    assert.equal(fitScale([300, 360], 'side', 394), 0.5);
  });

  test('one over the other the larger picture decides', () => {
    assert.equal(fitScale([300, 360], 'swipe', 360), 1);
    assert.equal(fitScale([300, 360], 'onion', 180), 0.5);
  });

  test('a single picture, no room known yet, or no width: nothing changes; a tiny room does not make them vanish', () => {
    assert.equal(fitScale([200], 'side', 116 + 100), 1);
    assert.equal(fitScale([200], 'side', 66), 0.25, 'the frame of one picture takes 16');
    assert.equal(fitScale([300, 360], 'side', 0), 1);
    assert.equal(fitScale([], 'side', 500), 1);
    assert.equal(fitScale([300], 'side', 10), 0.05);
  });
});

describe('reading the sides of a picture', () => {
  test('a side over the limit is never read, however large: its size comes first', async () => {
    const read: string[] = [];
    const svc = {
      blobSize: async () => 100 * 1024 * 1024,   // more than the buffer of the Git runner could take
      showBlob: async () => { read.push('blob'); return Buffer.alloc(1); },
      workingFileSize: async () => MAX_IMAGE_BYTES + 1,
      workingFile: async () => { read.push('file'); return Buffer.alloc(1); },
    } as unknown as GitService;
    const pair = await readImages(svc, { kind: 'rev', rev: 'abc', file: 'x.png' }, { kind: 'workingTree', file: 'x.png' });
    assert.deepEqual(pair, { old: { bytes: 100 * 1024 * 1024 }, new: { bytes: MAX_IMAGE_BYTES + 1 } }, 'both sides are there, as sizes: not "created" or "removed"');
    assert.deepEqual(read, []);
  });

  test('a side that does not exist stays missing, and nothing at all is no pair', async () => {
    const svc = { blobSize: async () => undefined, workingFileSize: async () => undefined } as unknown as GitService;
    assert.equal(await readImages(svc, { kind: 'rev', rev: 'abc', file: 'x.png' }, { kind: 'workingTree', file: 'x.png' }), undefined);
    assert.equal(await readImages(svc, { kind: 'index', file: 'x.txt' }, { kind: 'workingTree', file: 'x.txt' }), undefined, 'no picture format: nothing is even asked');
  });

  test('in a real repository: revision, index and working tree; files outside the repository are not read', async () => {
    const r = new TestRepo();
    const outside = mkdtempSync(path.join(tmpdir(), 'bonsai-outside-'));
    try {
      const red = png(2, 2, [255, 0, 0]);
      r.write('a.png', red); r.commit('add');
      const blue = png(3, 3, [0, 0, 255]);
      r.write('a.png', blue); r.git('add', 'a.png');
      r.write('a.png', png(4, 4, [0, 255, 0]));
      assert.equal(await r.svc.blobSize('HEAD', 'a.png'), red.length);
      assert.equal(await r.svc.blobSize('', 'a.png'), blue.length, 'the index');
      assert.equal(await r.svc.blobSize('HEAD', 'missing.png'), undefined);
      assert.deepEqual(await r.svc.showBlob('', 'a.png'), blue);
      assert.equal(await r.svc.workingFileSize('a.png'), png(4, 4, [0, 255, 0]).length);
      assert.equal(await r.svc.workingFile('gone.png'), undefined);

      writeFileSync(path.join(outside, 'secret.png'), red);
      assert.equal(await r.svc.workingFile(path.join('..', path.basename(outside), 'secret.png')), undefined, 'a path out of the repository');
      try { symlinkSync(path.join(outside, 'secret.png'), path.join(r.dir, 'link.png')); } catch { return; }   // Windows may not allow symlinks
      assert.equal(await r.svc.workingFile('link.png'), undefined, 'a link out of the repository');
      assert.equal(await r.svc.workingFileSize('link.png'), undefined);
    } finally { r.dispose(); rmSync(outside, { recursive: true, force: true }); }
  });
});
