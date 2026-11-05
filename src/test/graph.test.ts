import * as assert from 'assert';
import { computeGraph, visibleRows } from '../graph';
import { withStashes } from '../gitService';

// History (newest first):
//   M   merge(A2, B1)
//   B1  feature
//   A2  main
//   A1  common ancestor
const { rows, maxWidth } = computeGraph([
  { hash: 'M', parents: ['A2', 'B1'] },
  { hash: 'B1', parents: ['A1'] },
  { hash: 'A2', parents: ['A1'] },
  { hash: 'A1', parents: [] },
]);

assert.deepStrictEqual(rows.map(r => r.col), [0, 1, 0, 0]);
assert.strictEqual(maxWidth, 2);
// The merge opens a second lane
assert.ok(rows[0].segments.some(s => s.x1 === 0 && s.y1 === 0.5 && s.x2 === 1 && s.y2 === 1));
// A1: lane 1 joins column 0 from above
assert.ok(rows[3].segments.some(s => s.x1 === 1 && s.y1 === 0 && s.x2 === 0 && s.y2 === 0.5));
// The root commit has no line going down
assert.ok(!rows[3].segments.some(s => s.y2 === 1));

// Two independent branch tips
const two = computeGraph([
  { hash: 'X', parents: ['P'] },
  { hash: 'Y', parents: ['P'] },
  { hash: 'P', parents: [] },
]);
assert.deepStrictEqual(two.rows.map(r => r.col), [0, 1, 0]);
assert.notStrictEqual(two.rows[0].color, two.rows[1].color);

// Stashes sit directly above their base commit, newest first; stashes whose base is not in the log are dropped
const c = (hash: string, parents: string[]) => ({ hash, parents, author: '', email: '', date: 0, subject: hash });
const stash = (index: number, parent: string) => ({ name: `s${index}`, kind: 'stash' as const, hash: `S${index}`, index, parent, date: 1, author: 'a', email: 'e' });
const merged = withStashes([c('B', ['A']), c('A', [])], [stash(1, 'A'), stash(0, 'A'), stash(2, 'GONE')]);
assert.deepStrictEqual(merged.map(x => x.hash), ['B', 'S0', 'S1', 'A']);
assert.deepStrictEqual(merged[1].parents, ['A']);
assert.strictEqual(merged[1].stash, 0);
assert.deepStrictEqual(computeGraph(merged).rows.map(r => r.col), [0, 1, 2, 0]);

// Segments beyond the visible lanes are dropped; curves into the visible area stay
const vis = visibleRows([{
  col: 0, color: 0, width: 40, segments: [
    { x1: 30, y1: 0, x2: 30, y2: 1, color: 1 },   // fully hidden
    { x1: 5, y1: 0, x2: 5, y2: 1, color: 2 },     // visible
    { x1: 0, y1: 0.5, x2: 30, y2: 1, color: 3 },  // starts visible → stays
  ],
}], 24);
assert.deepStrictEqual(vis[0].segments.map(s => s.color), [2, 3]);
assert.strictEqual(vis[0].width, 40);

console.log('graph tests ok');
