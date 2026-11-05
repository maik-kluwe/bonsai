import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
interface Sel {
  click(h: number, line: number, mods: Mods, selectable: number[]): void;
  has(h: number, line: number): boolean;
  count(h: number): number;
  lines(): number[];
  hunk(): number;
  clear(): void;
}
const { createLineSelection }: { createLineSelection(): Sel } = require('../../media/linesel.js');

/** Changed lines of the hunk under test: 1, 2, 4, 5, 8 (3 and 6 are context). */
const CH = [1, 2, 4, 5, 8];

describe('createLineSelection', () => {
  test('a plain click marks one line and replaces an earlier mark', () => {
    const s = createLineSelection();
    s.click(0, 1, {}, CH);
    s.click(0, 4, {}, CH);
    assert.deepEqual(s.lines(), [4]);
    assert.ok(s.has(0, 4) && !s.has(0, 1));
  });

  test('clicking the only marked line again unmarks it and leaves no hunk behind', () => {
    const s = createLineSelection();
    s.click(2, 4, {}, CH);
    s.click(2, 4, {}, CH);
    assert.deepEqual(s.lines(), []);
    assert.equal(s.hunk(), -1);
  });

  test('Ctrl and Cmd toggle single lines', () => {
    const s = createLineSelection();
    s.click(0, 1, {}, CH);
    s.click(0, 5, { ctrlKey: true }, CH);
    s.click(0, 8, { metaKey: true }, CH);
    assert.deepEqual(s.lines(), [1, 5, 8]);
    s.click(0, 5, { ctrlKey: true }, CH);
    assert.deepEqual(s.lines(), [1, 8]);
  });

  test('Shift marks only the changed lines between the last click and this one', () => {
    const s = createLineSelection();
    s.click(0, 2, {}, CH);
    s.click(0, 5, { shiftKey: true }, CH);
    assert.deepEqual(s.lines(), [2, 4, 5], 'context line 3 is not selectable');
    s.click(0, 1, { shiftKey: true }, CH);
    assert.deepEqual(s.lines(), [1, 2], 'a shift range restarts from the anchor, it does not grow');
  });

  test('Shift without an earlier click behaves like a plain click', () => {
    const s = createLineSelection();
    s.click(0, 4, { shiftKey: true }, CH);
    assert.deepEqual(s.lines(), [4]);
  });

  test('the selection lives in one hunk: a click elsewhere starts over', () => {
    const s = createLineSelection();
    s.click(0, 1, {}, CH);
    s.click(0, 2, { ctrlKey: true }, CH);
    s.click(1, 4, { ctrlKey: true }, CH);
    assert.equal(s.hunk(), 1);
    assert.deepEqual(s.lines(), [4]);
    assert.equal(s.count(0), 0);
    assert.equal(s.count(1), 1);
  });

  test('clear forgets everything, including the anchor', () => {
    const s = createLineSelection();
    s.click(0, 2, {}, CH);
    s.clear();
    s.click(0, 5, { shiftKey: true }, CH);
    assert.deepEqual(s.lines(), [5]);
  });
});

describe('wiring', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '../../', p), 'utf8') as string;

  test('the webview marks lines only where a single line can move: not for untracked, conflicted, added or deleted files', () => {
    const js = read('media/main.js');
    assert.match(js, /lineAction\(m, st\)/); // the rule itself is tested in localdiff.test.ts
  });

  test('paging: the host grows the log limit (the webview side is tested in nav.test.ts)', () => {
    const panel = read('src/panel.ts');
    assert.match(panel, /case 'loadMore':\s+this\.logLimit \+=/);
    assert.match(panel, /more: log\.commits\.length >= this\.logLimit/);
  });
});
