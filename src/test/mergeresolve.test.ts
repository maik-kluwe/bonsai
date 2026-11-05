import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

type Seg = { t: 'text'; lines: string[] } | { t: 'conflict'; ours: string[]; theirs: string[] };
interface Resolution {
  segments: Seg[]; total: number;
  choose(ci: number, side: 'ours' | 'theirs', on: boolean): void;
  takeAll(side: 'ours' | 'theirs', on: boolean): void;
  isChosen(ci: number, side: 'ours' | 'theirs'): boolean;
  allChosen(side: 'ours' | 'theirs'): boolean;
  done(): number; lines(): string[];
  rows(): Array<{ text: string; side: string } | { conflict: number }>;
  isManual(): boolean; manualText(): string;
  startManual(): void; endManual(): void; setManual(t: string): void;
  hasOpenMarkers(): boolean; canResolve(): boolean; content(): string;
}
const M: {
  createResolution(s: Seg[], o: { eol: string; finalNewline: boolean; ours: string; theirs: string }): Resolution;
  joinLines(l: string[], eol: string, finalNewline: boolean): string;
} = require('../../media/mergeresolve.js');

const segs = (): Seg[] => [
  { t: 'text', lines: ['eins'] },
  { t: 'conflict', ours: ['O zwei'], theirs: ['T zwei'] },
  { t: 'text', lines: ['drei'] },
  { t: 'conflict', ours: ['O vier', 'O vier b'], theirs: [] },
  { t: 'text', lines: ['fuenf'] },
];
const make = (o: Partial<{ eol: string; finalNewline: boolean }> = {}) =>
  M.createResolution(segs(), { eol: '\n', finalNewline: true, ours: 'main', theirs: 'feat', ...o });

describe('joinLines', () => {
  test('empty list yields an empty file, even with a final newline', () => {
    assert.equal(M.joinLines([], '\n', true), '');
  });
});

describe('selection', () => {
  test('counts conflicts and progress', () => {
    const r = make();
    assert.equal(r.total, 2);
    assert.equal(r.done(), 0);
    assert.equal(r.canResolve(), false);
    r.choose(0, 'ours', true);
    assert.equal(r.done(), 1);
    r.choose(1, 'theirs', true);
    assert.equal(r.done(), 2);
    assert.equal(r.canResolve(), true);
  });

  test('of two chosen sides the one chosen first comes first, as in Fork', () => {
    const r = make();
    r.choose(0, 'ours', true);
    r.choose(0, 'theirs', true);
    r.choose(1, 'ours', true);
    assert.deepEqual(r.lines(), ['eins', 'O zwei', 'T zwei', 'drei', 'O vier', 'O vier b', 'fuenf']);
    assert.deepEqual(r.rows().slice(1, 3), [{ text: 'O zwei', side: 'ours' }, { text: 'T zwei', side: 'theirs' }]);
    r.choose(0, 'ours', false);
    r.choose(0, 'theirs', false);
    r.choose(0, 'theirs', true);
    r.choose(0, 'ours', true);
    assert.deepEqual(r.lines().slice(1, 3), ['T zwei', 'O zwei']);
  });

  test('a side that is taken back and chosen again goes behind the one that stayed', () => {
    const r = make();
    r.choose(0, 'ours', true);
    r.choose(0, 'theirs', true);
    r.choose(0, 'ours', false);
    r.choose(0, 'ours', true);
    assert.deepEqual(r.lines().slice(1, 3), ['T zwei', 'O zwei']);
  });

  test('taking a whole side counts as choosing it, and choosing it twice changes nothing', () => {
    const r = make();
    r.takeAll('ours', true);
    r.takeAll('theirs', true);
    r.takeAll('ours', true);
    assert.deepEqual(r.lines().slice(1, 3), ['O zwei', 'T zwei']);
  });

  test('deselecting a side reopens the conflict', () => {
    const r = make();
    r.takeAll('ours', true);
    assert.equal(r.canResolve(), true);
    r.choose(1, 'ours', false);
    assert.equal(r.done(), 1);
    assert.equal(r.canResolve(), false);
  });

  test('takeAll and allChosen', () => {
    const r = make();
    assert.equal(r.allChosen('theirs'), false);
    r.takeAll('theirs', true);
    assert.equal(r.allChosen('theirs'), true);
    assert.equal(r.allChosen('ours'), false);
    r.choose(1, 'theirs', false);
    assert.equal(r.allChosen('theirs'), false);
    assert.equal(r.isChosen(0, 'theirs'), true);
  });

  test('without conflicts: allChosen is false, but resolving is possible', () => {
    const r = M.createResolution([{ t: 'text', lines: ['a'] }], { eol: '\n', finalNewline: true, ours: 'a', theirs: 'b' });
    assert.equal(r.allChosen('ours'), false);
    assert.equal(r.canResolve(), true);
  });

  test('a side without lines deletes the block (theirs of conflict 2 is empty)', () => {
    const r = make();
    r.choose(0, 'ours', true);
    r.choose(1, 'theirs', true);
    assert.deepEqual(r.lines(), ['eins', 'O zwei', 'drei', 'fuenf']);
  });
});

describe('result', () => {
  test('open conflicts appear with markers and the branch names', () => {
    const r = make();
    r.choose(0, 'ours', true);
    assert.deepEqual(r.lines(), [
      'eins', 'O zwei', 'drei',
      '<<<<<<< main', 'O vier', 'O vier b', '=======', '>>>>>>> feat',
      'fuenf',
    ]);
  });

  test('rows: source side per line, open conflicts as placeholders', () => {
    const r = make();
    r.choose(0, 'theirs', true);
    r.choose(0, 'ours', true);
    assert.deepEqual(r.rows(), [
      { text: 'eins', side: '' },
      { text: 'T zwei', side: 'theirs' },
      { text: 'O zwei', side: 'ours' },
      { text: 'drei', side: '' },
      { conflict: 1 },
      { text: 'fuenf', side: '' },
    ]);
  });

  test("content: the file's line ending and final newline are preserved", () => {
    for (const [eol, finalNewline] of [['\n', true], ['\r\n', true], ['\r\n', false]] as const) {
      const r = make({ eol, finalNewline });
      r.takeAll('ours', true);
      const want = ['eins', 'O zwei', 'drei', 'O vier', 'O vier b', 'fuenf'].join(eol) + (finalNewline ? eol : '');
      assert.equal(r.content(), want, JSON.stringify({ eol, finalNewline }));
    }
  });
});

describe('manual editing', () => {
  test('starts with the current result, open conflicts with markers', () => {
    const r = make();
    r.choose(0, 'ours', true);
    r.startManual();
    assert.equal(r.isManual(), true);
    assert.ok(r.manualText().includes('<<<<<<< main'));
    assert.equal(r.manualText().endsWith('fuenf\n'), true);
    assert.equal(r.canResolve(), false);
  });

  test('manual text with mixed line endings is normalized', () => {
    const r = make({ eol: '\r\n' });
    r.startManual();
    r.setManual('a\r\nb\nc');
    assert.equal(r.content(), 'a\r\nb\r\nc');
  });

  test('a remaining start or end marker blocks resolving; a lone "=======" line or similar text does not', () => {
    const r = make();
    r.startManual();
    for (const [name, text, blocks] of [
      ['start marker', 'x\n<<<<<<< main\ny\n', true],
      ['end marker', 'x\r\n>>>>>>> feat\r\n', true],
      ['no marker', 'x\n', false],
      ['"=======" (Markdown/RST underline)', 'Titel\n=======\ntext\n', false],
      ['another name', '<<<<<<< anderer\n>>>>>>> noch ein\n<<<<<<<\n', false],
    ] as const) {
      r.setManual(text);
      assert.equal(r.canResolve(), !blocks, name);
      assert.equal(r.hasOpenMarkers(), blocks, name);
    }
  });

  test('going back to the selection discards the manual text', () => {
    const r = make();
    r.takeAll('ours', true);
    r.startManual();
    r.setManual('völlig anders');
    r.endManual();
    assert.equal(r.isManual(), false);
    assert.equal(r.content(), 'eins\nO zwei\ndrei\nO vier\nO vier b\nfuenf\n');
  });
});
