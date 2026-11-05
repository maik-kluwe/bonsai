import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createMergeHtml }: { createMergeHtml(deps: any): { dialog(d: any): string; result(rows: any[]): string } } = require('../../media/mergehtml.js');
const { esc }: { esc(s: string): string } = require('../../media/diffhtml.js');

const t = (key: string, ...args: unknown[]) => `${key}${args.length ? `(${args.join(',')})` : ''}`;
const html = createMergeHtml({ t, esc, icons: { branch: '<svg></svg>' }, fmtDate: (d: unknown) => `date:${d}` });

const conflict = (theirs: string[], ours: string[]) => ({ t: 'conflict', theirs, ours });
const text = (...lines: string[]) => ({ t: 'text', lines });
const dialog = (segments: any[], sides?: any) => html.dialog({ path: 'a<b>.txt', segments, ours: 'main', theirs: 'dev', sides });
/** Cells of the grid as [class, content]. */
const cells = (s: string) => [...s.matchAll(/<div class="(m[clt]) ([^"]*)"[^>]*>(.*?)<\/div>/g)].map(m => [m[1], m[2], m[3]]);

describe('merge dialog: frame', () => {
  test('names the file and the two branches, escaped, and starts with an empty result; a card shows the last commit of its side only when there is one', () => {
    const s = html.dialog({ path: 'a<b>.txt', segments: [], ours: 'x"y', theirs: 'dev', sides: undefined });
    assert.match(s, /<span class="mfile">a&lt;b&gt;\.txt<\/span>/);
    assert.match(s, /<b>x&quot;y<\/b>/);
    assert.match(s, /<div class="mres" id="mres"><\/div>/);
    assert.doesNotMatch(dialog([]), /cmeta/);
    const card = dialog([], { ours: { hash: 'abc', subject: 'a & b', date: 5 } });
    assert.match(card, /<span class="mono">abc<\/span><span class="csub">a &amp; b<\/span><span>date:5<\/span>/);
    assert.equal(card.match(/cmeta/g)?.length, 1);
  });

  test('theirs stands on the left, as in Fork, and each side is a pane of its own', () => {
    const cards = dialog([]);
    assert.ok(cards.indexOf('data-side="theirs"') < cards.indexOf('data-side="ours"'));
    const s = dialog([conflict(['t'], ['o'])]);
    const panes = s.split('<div class="mside">').slice(1);
    assert.equal(panes.length, 2);
    assert.match(panes[0], /side-theirs/);
    assert.doesNotMatch(panes[0], /side-ours/);
    assert.match(panes[1], /side-ours/);
  });
});

describe('merge dialog: grid', () => {
  test('text counts on both sides and has no checkboxes', () => {
    const c = cells(dialog([text('a<')]));
    assert.deepEqual(c.map(x => x[2]), ['', '1', 'a&lt;', '', '1', 'a&lt;']);
  });

  test('line numbers go on after a conflict with sides of different length', () => {
    const lines = cells(dialog([conflict(['t1', 't2'], ['o1']), text('x')])).filter(x => x[0] === 'ml').map(x => x[2]);
    assert.deepEqual(lines, ['1', '2', '3', '1', '', '2']);
  });

  test('the shorter side is filled up from its second row on', () => {
    const c = cells(dialog([conflict(['t1', 't2'], ['o1'])]));
    assert.deepEqual(c.filter(x => x[0] === 'mt').map(x => x[1]), ['side-theirs', 'side-theirs', 'side-ours', 'fill']);
  });

  test('an empty side still shows its colour and checkbox on the first row', () => {
    const s = dialog([conflict(['t1'], [])]);
    assert.deepEqual(cells(s).filter(x => x[0] === 'mt').map(x => x[1]), ['side-theirs', 'side-ours']);
    assert.equal(s.match(/class="mcb"/g)?.length, 2);
  });

  test('every conflict gets its own number, once, for the checkboxes and for jumping to it', () => {
    const s = dialog([conflict(['a', 'b'], ['c']), text('x'), conflict(['d'], ['e'])]);
    assert.deepEqual([...s.matchAll(/class="mcb" data-ci="(\d)" data-side="(\w+)"/g)].map(m => m[1] + m[2]), ['0theirs', '1theirs', '0ours', '1ours']);
    assert.deepEqual([...s.matchAll(/data-cstart="(\d)"/g)].map(m => m[1]), ['0', '1']);
  });
});

describe('merge dialog: result', () => {
  test('lines are numbered, conflicts are not and do not count', () => {
    const s = html.result([{ text: 'a', side: '' }, { conflict: 0 }, { text: 'b<', side: 'ours' }]);
    assert.match(s, /<span class="ln">1<\/span><span class="rt">a<\/span>/);
    assert.match(s, /<div class="rl rconf" data-ci="0"><span class="ln"><\/span><span class="rt">conflictRow<\/span>/);
    assert.match(s, /<div class="rl side-ours"><span class="ln">2<\/span><span class="rt">b&lt;<\/span>/);
  });
});
