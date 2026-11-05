import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { parseDiff } from '../diff';
import { TO_HOST_TYPES, TO_WEBVIEW_TYPES, diffPayload, isToHost, sanitizeLook } from '../protocol';
import { MAIN_SCRIPTS } from '../webviewAssets';

const read = (rel: string) => readFileSync(path.join(__dirname, rel), 'utf8');
const mainJs = read('../../media/main.js');
const unique = (xs: string[]) => [...new Set(xs)].sort();
const matches = (src: string, re: RegExp) => unique([...src.matchAll(re)].map(m => m[1]));

describe('diffPayload', () => {
  const raw = [
    'diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f',
    '@@ -1,2 +1,2 @@ ctx', ' same', '-old', '+new',
    '@@ -10 +10 @@', '-x', '+y',
  ].join('\n');

  test('keeps header and lines of every hunk, drops the raw patch text, passes the binary flag through', () => {
    const p = diffPayload(parseDiff(raw));
    assert.equal(p.binary, false, 'text');
    assert.deepEqual(p.hunks.map(h => h.header), ['@@ -1,2 +1,2 @@ ctx', '@@ -10 +10 @@'], 'text');
    assert.deepEqual(p.hunks[0].lines.map(l => l.t + l.text), [' same', '-old', '+new'], 'text');
    for (const h of p.hunks) assert.deepEqual(Object.keys(h).sort(), ['header', 'lines'], 'text');
    const bin = diffPayload(parseDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ'));
    assert.equal(bin.binary, true, 'binary');
    assert.deepEqual(bin.hunks, [], 'binary');
  });
});

describe('sanitizeLook', () => {
  test('keeps a valid look, including the whole file (null), and falls back on anything else', () => {
    assert.deepEqual(sanitizeLook({ ws: true, eol: true, wrap: false, iws: true, ctx: 10 }), { ws: true, eol: true, wrap: false, iws: true, ctx: 10 }, 'valid');
    assert.equal(sanitizeLook({ ctx: null }).ctx, null, 'whole file');
    assert.deepEqual(sanitizeLook(undefined), { ws: false, eol: false, wrap: false, iws: false, ctx: 3 }, 'nothing stored');
    assert.deepEqual(sanitizeLook({ ws: 'yes', wrap: 1, ctx: -2 }), { ws: false, eol: false, wrap: false, iws: false, ctx: 3 }, 'wrong types');
    assert.equal(sanitizeLook({ ctx: 2.5 }).ctx, 3, 'not whole');
    assert.equal(sanitizeLook({ ctx: 1e9 }).ctx, 100000, 'too many');
  });
});

describe('isToHost', () => {
  test('accepts known types and rejects everything else', () => {
    assert.equal(isToHost({ type: 'commit', message: 'm', amend: false }), true);
    assert.equal(isToHost({ type: 'nope' }), false);
    assert.equal(isToHost({}), false);
    assert.equal(isToHost(null), false);
    assert.equal(isToHost('commit'), false);
    assert.equal(isToHost(undefined), false);
  });
});

describe('contract with the scripts of the main view', () => {
  test('main.js handles exactly the messages the host can send', () => {
    const start = mainJs.indexOf("window.addEventListener('message'");
    const end = mainJs.indexOf('// ---------- Toolbar');
    assert.ok(start > -1 && end > start, 'message handler not found in main.js');
    const handled = matches(mainJs.slice(start, end), /case '(\w+)'/g);
    assert.deepEqual(handled, unique(TO_WEBVIEW_TYPES));
  });

  test('a status event that leaves the lists alone still has the diff read again: only its content may have changed', () => {
    assert.match(read('../../src/panel.ts'), /if \(sig === this\.lastSig\) \{ if \(!listsSent\) this\.post\(\{ type: 'recheck' \}\); return; \}/);
    assert.match(mainJs, /case 'recheck': local\.load\(selection\.target\(\)\); break;/);
  });

  test('the refresh button asks Git for the status first: repo.state only follows it with a delay', () => {
    assert.match(read('../../src/panel.ts'), /case 'refresh': this\.logCache = undefined; this\.lastSig = undefined; await this\.repo\?\.status\(\); this\.refresh\(\); return;/);
  });

  test('every message the scripts of the main view send is part of ToHost', () => {
    const sent = unique(MAIN_SCRIPTS.flatMap(f => {
      const src = read(`../../media/${f}`);
      return [...matches(src, /\bpost(?:Message)?\(\{ type: '(\w+)'/g), ...matches(src, /\bsend\('(\w+)'\)/g)];
    }));
    assert.ok(sent.length > 10, `only ${sent.length} send sites found, regex out of date?`);
    const unknown = sent.filter(t => !TO_HOST_TYPES.includes(t));
    assert.deepEqual(unknown, [], 'the scripts send types missing in ToHost');
  });
  // That the host handles every type is checked by the compiler (messages.ts) and by messages.test.ts
});
