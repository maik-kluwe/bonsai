import * as assert from 'assert';
import { parseMergeFile } from '../merge';

const text = [
  'a',
  '<<<<<<< FV_OURS', 'o1', 'o2',
  '||||||| FV_BASE', 'b1',
  '=======', 't1',
  '>>>>>>> FV_THEIRS',
  'z',
  '',
].join('\n');

const p = parseMergeFile(text, '\n');
assert.deepStrictEqual(p.segments, [
  { t: 'text', lines: ['a'] },
  { t: 'conflict', ours: ['o1', 'o2'], base: ['b1'], theirs: ['t1'] },
  { t: 'text', lines: ['z'] },
]);
assert.strictEqual(p.finalNewline, true);

// without a base section and with CRLF
const crlf = ['x', '<<<<<<< FV_OURS', 'o', '=======', 't', '>>>>>>> FV_THEIRS'].join('\r\n');
const q = parseMergeFile(crlf, '\r\n');
assert.deepStrictEqual(q.segments[1], { t: 'conflict', ours: ['o'], base: [], theirs: ['t'] });
assert.strictEqual(q.finalNewline, false);

// A line that only looks like a marker stays text
const fake = parseMergeFile('=======\n>>>>>>> FV_THEIRS\n', '\n');
assert.deepStrictEqual(fake.segments, [{ t: 'text', lines: ['=======', '>>>>>>> FV_THEIRS'] }]);

console.log('merge tests ok');
