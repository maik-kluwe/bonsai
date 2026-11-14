import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';

type Files = { unstaged: { path: string }[]; staged: { path: string }[] };
type Which = 'staged' | 'unstaged';
type Shown = { path: string; staged: boolean } | null;
interface Selection {
  has(w: Which, p: string): boolean; count(w: Which): number; paths(w: Which): string[];
  target(): { path: string; staged: boolean; index: number } | null;
  click(w: Which, f: Files, i: number, mods?: { shift?: boolean; ctrl?: boolean }): Shown;
  move(w: Which, f: Files, delta: number, mods?: { shift?: boolean }): Shown;
  selectAll(w: Which, f: Files): void;
  only(w: Which, p: string, f: Files): Shown;
  prune(f: Files): void;
  restore(f: Files): Shown | 'clear';
}
const { createSelection }: { createSelection(): Selection } = require('../../media/selection.js');

const mk = (...names: string[]) => names.map(p => ({ path: p }));
const files = (unstaged: string[], staged: string[] = []): Files => ({ unstaged: mk(...unstaged), staged: mk(...staged) });

describe('clicking', () => {
  test('a plain click selects only that file and shows its diff', () => {
    const s = createSelection(), f = files(['a', 'b', 'c']);
    assert.deepEqual(s.click('unstaged', f, 1), { path: 'b', staged: false });
    assert.deepEqual(s.paths('unstaged'), ['b']);
    assert.deepEqual(s.target(), { path: 'b', staged: false, index: 1 });
    s.click('unstaged', f, 2);
    assert.deepEqual(s.paths('unstaged'), ['c']);
  });

  test('Ctrl toggles; when the file is deselected there is no diff and the target stays', () => {
    const s = createSelection(), f = files(['a', 'b', 'c']);
    s.click('unstaged', f, 0);
    assert.deepEqual(s.click('unstaged', f, 2, { ctrl: true }), { path: 'c', staged: false });
    assert.deepEqual(s.paths('unstaged').sort(), ['a', 'c']);
    assert.equal(s.click('unstaged', f, 2, { ctrl: true }), null);
    assert.deepEqual(s.paths('unstaged'), ['a']);
    assert.equal(s.target()?.path, 'c');
  });

  test('Shift selects the range from the anchor, in both directions', () => {
    const s = createSelection(), f = files(['a', 'b', 'c', 'd', 'e']);
    s.click('unstaged', f, 1);
    s.click('unstaged', f, 3, { shift: true });
    assert.deepEqual(s.paths('unstaged').sort(), ['b', 'c', 'd']);
    s.click('unstaged', f, 0, { shift: true });
    assert.deepEqual(s.paths('unstaged').sort(), ['a', 'b']);
  });

  test('Shift+Ctrl adds the range to the existing selection', () => {
    const s = createSelection(), f = files(['a', 'b', 'c', 'd', 'e']);
    s.click('unstaged', f, 0);
    s.click('unstaged', f, 3, { ctrl: true });
    s.click('unstaged', f, 4, { shift: true, ctrl: true });
    assert.deepEqual(s.paths('unstaged').sort(), ['a', 'd', 'e']);
  });

  test('Shift without an anchor in this list acts like a plain click', () => {
    const s = createSelection(), f = files(['a', 'b'], ['x', 'y']);
    s.click('unstaged', f, 0);
    s.click('staged', f, 1, { shift: true });
    assert.deepEqual(s.paths('staged'), ['y']);
    assert.equal(s.count('unstaged'), 0);
  });

  test('the selection is always in one list only', () => {
    const s = createSelection(), f = files(['a', 'b'], ['x']);
    s.click('unstaged', f, 0);
    s.click('unstaged', f, 1, { ctrl: true });
    s.click('staged', f, 0, { ctrl: true });
    assert.equal(s.count('unstaged'), 0);
    assert.deepEqual(s.paths('staged'), ['x']);
    assert.equal(s.target()?.staged, true);
  });
});

describe('arrow keys', () => {
  test('Down selects the next file only and shows its diff', () => {
    const s = createSelection(), f = files(['a', 'b', 'c']);
    s.click('unstaged', f, 0);
    assert.deepEqual(s.move('unstaged', f, 1), { path: 'b', staged: false });
    assert.deepEqual(s.paths('unstaged'), ['b']);
    assert.deepEqual(s.target(), { path: 'b', staged: false, index: 1 });
  });

  test('Up goes back, and at either end the selection stays where it is', () => {
    const s = createSelection(), f = files(['a', 'b', 'c']);
    s.click('unstaged', f, 1);
    assert.deepEqual(s.move('unstaged', f, -1), { path: 'a', staged: false });
    assert.deepEqual(s.move('unstaged', f, -1), { path: 'a', staged: false }, 'first stays');
    s.click('unstaged', f, 2);
    assert.deepEqual(s.move('unstaged', f, 1), { path: 'c', staged: false }, 'last stays');
    assert.deepEqual(s.paths('unstaged'), ['c']);
  });

  test('in a list the diff is not in, the first arrow press selects its first file', () => {
    const s = createSelection(), f = files(['a', 'b'], ['x', 'y']);
    s.click('unstaged', f, 1);
    assert.deepEqual(s.move('staged', f, 1), { path: 'x', staged: true });
    assert.equal(s.count('unstaged'), 0);
    s.click('unstaged', f, 1);
    assert.deepEqual(s.move('staged', f, -1), { path: 'x', staged: true }, 'also with Up');
  });

  test('a file that is in both lists counts only in the list its diff is shown for', () => {
    const s = createSelection(), f = files(['a', 'b'], ['a']);
    s.click('staged', f, 0);
    assert.deepEqual(s.move('unstaged', f, 1), { path: 'a', staged: false }, 'starts at the top, not after a');
  });

  test('Shift+arrow grows the range from the anchor and shrinks it again going back', () => {
    const s = createSelection(), f = files(['a', 'b', 'c', 'd']);
    s.click('unstaged', f, 1);
    s.move('unstaged', f, 1, { shift: true });
    assert.deepEqual(s.move('unstaged', f, 1, { shift: true }), { path: 'd', staged: false });
    assert.deepEqual(s.paths('unstaged').sort(), ['b', 'c', 'd']);
    s.move('unstaged', f, -1, { shift: true });
    assert.deepEqual(s.paths('unstaged').sort(), ['b', 'c']);
    s.move('unstaged', f, -1, { shift: true });
    s.move('unstaged', f, -1, { shift: true });
    assert.deepEqual(s.paths('unstaged').sort(), ['a', 'b'], 'past the anchor it grows the other way');
  });

  test('on an empty list there is nothing to select', () => {
    const s = createSelection();
    assert.equal(s.move('unstaged', files([]), 1), null);
  });
});

describe('Ctrl+A, only, prune', () => {
  test('selectAll selects the whole list, clears the other and leaves the diff target', () => {
    const s = createSelection(), f = files(['a', 'b', 'c'], ['x']);
    s.click('staged', f, 0);
    s.selectAll('unstaged', f);
    assert.deepEqual(s.paths('unstaged'), ['a', 'b', 'c']);
    assert.equal(s.count('staged'), 0);
    const kept = createSelection();
    kept.click('unstaged', f, 1);
    kept.selectAll('unstaged', f);
    assert.equal(kept.target()?.path, 'b');
  });

  test('only selects exactly one file, clears the other list and shows the diff', () => {
    const s = createSelection(), f = files(['a', 'b'], ['x']);
    s.click('staged', f, 0);
    assert.deepEqual(s.only('unstaged', 'b', f), { path: 'b', staged: false });
    assert.deepEqual(s.paths('unstaged'), ['b']);
    assert.equal(s.count('staged'), 0);
    assert.equal(s.only('unstaged', 'gibt-es-nicht', f), null);
  });

  test('prune removes selections of files that disappeared', () => {
    const s = createSelection(), f = files(['a', 'b', 'c']);
    s.selectAll('unstaged', f);
    s.prune(files(['a', 'c']));
    assert.deepEqual(s.paths('unstaged'), ['a', 'c']);
  });
});

describe('restore after a refresh', () => {
  test('the file is still there: diff stays, position is updated', () => {
    const s = createSelection();
    s.click('unstaged', files(['a', 'b', 'c']), 2);
    assert.deepEqual(s.restore(files(['c'])), { path: 'c', staged: false });
    assert.equal(s.target()?.index, 0);
  });

  test('the file is gone: successor at the same position, or the new last one', () => {
    for (const [at, left, want] of [[1, ['a', 'c'], 'c'], [2, ['a', 'b'], 'b']] as const) {
      const s = createSelection();
      s.click('unstaged', files(['a', 'b', 'c']), at);
      const after = files([...left]);
      s.prune(after); // as in the webview: prune the selection first, then update the diff
      assert.deepEqual(s.restore(after), { path: want, staged: false }, `position ${at}`);
      assert.deepEqual(s.paths('unstaged'), [want], `position ${at}`);
    }
  });

  test('an existing multi-selection is left untouched', () => {
    const s = createSelection(), f = files(['a', 'b', 'c', 'd']);
    s.click('unstaged', f, 0);
    s.click('unstaged', f, 3, { shift: true });
    s.restore(files(['b', 'c', 'd']));
    assert.deepEqual(s.paths('unstaged').sort(), ['a', 'b', 'c', 'd']);
  });

  test('fully staged: list empty, file in the other → continue there', () => {
    const s = createSelection();
    s.click('unstaged', files(['a']), 0);
    assert.deepEqual(s.restore(files([], ['a'])), { path: 'a', staged: true });
    assert.deepEqual(s.paths('staged'), ['a']);
    assert.equal(s.target()?.staged, true);
  });

  test('file in the other list but own list not empty: successor instead of jumping', () => {
    const s = createSelection();
    s.click('unstaged', files(['a', 'b']), 0);
    assert.deepEqual(s.restore(files(['b'], ['a'])), { path: 'b', staged: false });
  });

  test('nothing left to select: "clear", afterwards there is no target', () => {
    const s = createSelection();
    s.click('unstaged', files(['a']), 0);
    assert.equal(s.restore(files([])), 'clear');
    assert.equal(s.target(), null);
    assert.equal(s.restore(files(['x'])), null);
  });
});

describe('wiring', () => {
  test('double-click on a file is detected in the click handler, not via dblclick (the first click re-renders the list)', () => {
    const js = readFileSync(path.join(__dirname, '../../media/main.js'), 'utf8');
    assert.ok(!js.includes("changesView.addEventListener('dblclick'"), 'dblclick listener on the changes list is back');
    assert.ok(js.includes('e.detail === 2'), 'click handler does not look at e.detail');
  });
});
