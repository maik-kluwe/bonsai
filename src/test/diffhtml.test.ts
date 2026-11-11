import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

const { createDiffBody, esc }: { createDiffBody(deps: any): (m: any, hunkBtns: string, pickLines?: any, look?: any) => string; esc(s: string): string } = require('../../media/diffhtml.js');
const { ICONS }: { ICONS: Record<string, string> } = require('../../media/icons.js');

const t = (key: string, ...args: unknown[]) => `${key}${args.length ? `(${args.join(',')})` : ''}`;
const none: { count(h: number): number; has(h: number, l: number): boolean } = { count: () => 0, has: () => false };
const body = (lineSel = none) => createDiffBody({ t, lineSel });
const diff = (lines: { t: string; text: string; o?: number; n?: number }[]) => ({ binary: false, hunks: [{ header: '@@ -1 +1 @@', lines }] });

describe('esc', () => {
  test('escapes what HTML treats specially', () => {
    assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    assert.equal(esc(undefined as unknown as string), '');
  });
});

describe('diff body: what is said instead of a table', () => {
  test('a missing, binary or empty diff', () => {
    assert.match(body()({ missing: true, hunks: [] }, ''), /diffMissing/);
    assert.match(body()({ binary: true, hunks: [] }, ''), /diffBinary/);
    assert.match(body()({ binary: false, hunks: [] }, ''), /diffEmpty/);
  });
});

describe('diff body: lines', () => {
  const one = (text: string, look: any = null, extra: any[] = []) =>
    body()(diff([{ t: '+', text, n: 1 }, ...extra]), '', null, look);
  const code = (html: string) => /<td class="tx">(.*?)<\/td>/.exec(html)![1];

  test('line numbers, sign and escaped text; the classes tell added, removed and context apart', () => {
    const html = body()(diff([{ t: ' ', text: 'a<b', o: 1, n: 1 }, { t: '-', text: 'old', o: 2 }, { t: '+', text: 'new', n: 2 }]), '');
    assert.match(html, /<tr class="l lctx"><td class="ln">1<\/td><td class="ln">1<\/td><td class="sg"> <\/td><td class="tx">a&lt;b<\/td>/);
    assert.match(html, /class="l ldel"/);
    assert.match(html, /class="l ladd"/);
  });

  test('an empty line keeps a space so the row does not collapse', () => {
    assert.equal(code(one('')), ' ');
  });

  test('the header and the buttons of a hunk', () => {
    const html = body()(diff([{ t: '+', text: 'x', n: 1 }]), '<button>Stage</button>');
    assert.match(html, /<span class="hh">@@ -1 \+1 @@<\/span>.*<button>Stage<\/button>/);
    assert.match(html, /class="hunk" data-i="0"/);
  });

  test('spaces become dots and tabs arrows, only when asked for', () => {
    assert.equal(code(one('a b')), 'a b');
    assert.equal(code(one('a  b', { ws: true, eol: false })), 'a<span class="ws">··</span>b');
    assert.equal(code(one('\tx', { ws: true, eol: false })), '<span class="ws">→   </span>x');
  });

  test('line ends: ¶ for LF, ␍¶ for CRLF, nothing at all without the option', () => {
    assert.equal(code(one('abc', { ws: false, eol: true })), 'abc<span class="ws">¶</span>');
    assert.equal(code(one('abc\r', { ws: false, eol: true })), 'abc<span class="ws">␍¶</span>');
    assert.equal(code(one('abc\r')), 'abc'); // the CR is dropped from the text
  });

  test('the last line of a file without a newline has no line end', () => {
    const html = body()(diff([{ t: '+', text: 'abc', n: 1 }, { t: '\\', text: ' No newline at end of file' }]), '', null, { ws: false, eol: true });
    assert.equal(code(html), 'abc');
    assert.match(html, /class="l lmeta"/);
  });
});

describe('diff body: picking lines', () => {
  const lines = [{ t: ' ', text: 'x', o: 1, n: 1 }, { t: '-', text: 'old', o: 2 }, { t: '+', text: 'new', n: 2 }];

  test('only changed lines can be picked, and marked ones look it', () => {
    const html = body({ count: () => 0, has: (h, l) => h === 0 && l === 2 })(diff(lines), '', 'stage');
    assert.equal((html.match(/data-l=/g) ?? []).length, 2);
    assert.match(html, /class="l ldel pick" data-l="1"/);
    assert.match(html, /class="l ladd pick sel" data-l="2"/);
    assert.doesNotMatch(html, /data-l="0"/);
  });

  test('without the option nothing can be picked', () => {
    assert.doesNotMatch(body()(diff(lines), ''), /data-l=|pick/);
  });

  test('a hunk with marked lines gets buttons for just those, in the direction of the side', () => {
    const marked = { count: () => 2, has: () => false };
    assert.match(body(marked)(diff(lines), '', 'stage'), /data-lines="stage">stageLines\(2\).*data-lines="discard">discardLines\(2\)/);
    assert.match(body(marked)(diff(lines), '', 'unstage'), /data-lines="unstage">unstageLines\(2\)/);
    assert.doesNotMatch(body()(diff(lines), '', 'stage'), /data-lines=/);
  });
});

describe('icons', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  test('every icon the code names exists', () => {
    const files = readdirSync(path.join(root, 'media')).filter(f => f.endsWith('.js')).map(f => `media/${f}`).concat(['src/pageHtml.ts']);
    const used = new Set<string>();
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\bICONS\.(\w+)/g)) used.add(m[1]);
      for (const m of src.matchAll(/data-icon="(\w+)"/g)) used.add(m[1]);
    }
    assert.ok(used.size > 15, 'scan found too few icons, regex out of date?');
    for (const name of used) assert.ok(name in ICONS, `icon ${name} does not exist`);
  });
});
