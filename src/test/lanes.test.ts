import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { GRAPH_MAX_LANES } from '../graph';

interface Lanes {
  LANE_W: number; MAX_LANES: number; MIN_LANES: number; MIN_SUBJECT: number; MIN_MAIN: number; FIXED_COLS: number; PAD: number;
  visibleLanes(listWidth: number): number;
  rowLayout(g: { width: number; col: number }, maxLanes: number): { width: number; col: number; clamped: boolean };
}
// media/ is outside src/ (rootDir), hence require; at runtime: out/test → ../../media
const L: Lanes = require('../../media/lanes.js');
const css = readFileSync(path.join(__dirname, '../../media/main.css'), 'utf8');

describe('visibleLanes', () => {
  test('all lanes when wide, as many as leave room for the message when narrow, never below the minimum', () => {
    // 600 − 388 (fixed columns) = 212 → (212 − 6 − 150) / 12 = 4.67 → 4
    for (const [width, want] of [[1500, 24], [5000, 24], [600, 4], [300, L.MIN_LANES], [0, L.MIN_LANES], [-50, L.MIN_LANES]]) {
      assert.equal(L.visibleLanes(width), want, `${width}px`);
    }
  });

  test('grows with the width, never above the maximum', () => {
    let prev = 0;
    for (let w = 0; w <= 2500; w += 7) {
      const n = L.visibleLanes(w);
      assert.ok(n >= prev, `at ${w}px fewer lanes than at a smaller width`);
      assert.ok(n >= L.MIN_LANES && n <= L.MAX_LANES);
      prev = n;
    }
    assert.equal(prev, L.MAX_LANES);
  });

  test('the subject column keeps at least its minimum width once more than the minimum lanes fit', () => {
    for (let w = 0; w <= 2500; w += 5) {
      const n = L.visibleLanes(w);
      if (n === L.MIN_LANES) continue; // lower bound applies: not enough room left
      const main = Math.max(L.MIN_MAIN, w - L.FIXED_COLS);
      const subject = main - (n * L.LANE_W + L.PAD);
      assert.ok(subject >= L.MIN_SUBJECT, `at ${w}px only ${subject}px are left for the message`);
    }
  });
});

describe('rowLayout', () => {
  test('a row fits the visible lanes; a commit beyond them gets its dot at the right edge, marked', () => {
    const cases: [string, { width: number; col: number }, number, Partial<ReturnType<Lanes['rowLayout']>>][] = [
      ['within the visible lanes', { width: 2, col: 1 }, 24, { width: 2 * L.LANE_W + L.PAD, col: 1, clamped: false }],
      ['wide row is cut down', { width: 138, col: 3 }, 4, { width: 4 * L.LANE_W + L.PAD, col: 3, clamped: false }],
      ['beyond the visible lanes', { width: 40, col: 30 }, 24, { width: 24 * L.LANE_W + L.PAD, col: 23, clamped: true }],
      ['the last visible lane', { width: 10, col: 3 }, 4, { clamped: false }],
      ['the first hidden lane', { width: 10, col: 4 }, 4, { col: 3, clamped: true }],
    ];
    for (const [name, row, lanes, want] of cases) {
      const got = L.rowLayout(row, lanes);
      assert.deepEqual({ ...got, ...want }, got, name);
    }
  });
});

describe('constants match CSS and host', () => {
  test('MAX_LANES entspricht GRAPH_MAX_LANES in src/graph.ts', () => {
    assert.equal(L.MAX_LANES, GRAPH_MAX_LANES);
  });

  test('fixed columns and minimum width match the row grid in main.css', () => {
    const block = /\.row\s*\{[^}]*\}/.exec(css)![0];
    const cols = /grid-template-columns:\s*minmax\((\d+)px,\s*1fr\)\s+(\d+)px\s+(\d+)px\s+(\d+)px/.exec(block);
    assert.ok(cols, 'row grid-template-columns not found');
    const [min, author, hash, date] = cols!.slice(1).map(Number);
    const padRight = Number(/padding-right:\s*(\d+)px/.exec(block)![1]);
    assert.equal(min, L.MIN_MAIN);
    assert.equal(author + hash + date + padRight, L.FIXED_COLS);
  });
});
