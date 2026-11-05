import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { Status } from '../git';
import { isConflict, stashLabel, statusLetter } from '../changes';

const NORMAL: [Status, string][] = [
  [Status.INDEX_MODIFIED, 'M'], [Status.INDEX_ADDED, 'A'], [Status.INDEX_DELETED, 'D'],
  [Status.INDEX_RENAMED, 'R'], [Status.INDEX_COPIED, 'C'], [Status.MODIFIED, 'M'],
  [Status.DELETED, 'D'], [Status.UNTRACKED, 'U'], [Status.IGNORED, 'I'],
  [Status.INTENT_TO_ADD, 'A'], [Status.INTENT_TO_RENAME, 'R'], [Status.TYPE_CHANGED, 'T'],
];
const CONFLICTS = [
  Status.ADDED_BY_US, Status.ADDED_BY_THEM, Status.DELETED_BY_US, Status.DELETED_BY_THEM,
  Status.BOTH_ADDED, Status.BOTH_DELETED, Status.BOTH_MODIFIED,
];

describe('Status', () => {
  test('normal statuses have a letter and are not conflicts', () => {
    for (const [s, letter] of NORMAL) {
      assert.equal(statusLetter(s), letter, `Status ${s}`);
      assert.equal(isConflict(s), false, `Status ${s}`);
    }
  });

  test('all seven conflict statuses are conflicts and show "!"', () => {
    for (const s of CONFLICTS) {
      assert.equal(isConflict(s), true, `Status ${s}`);
      assert.equal(statusLetter(s), '!', `Status ${s}`);
    }
  });
});

describe('stashLabel', () => {
  test('strips only the first "On <branch>: " or "WIP on <branch>: ", other names stay', () => {
    const cases: [string, string][] = [
      ['On main: erster', 'erster'], ['WIP on main: abc1234 Betreff', 'abc1234 Betreff'], ['on feature/a: klein', 'klein'],
      ['On main: a: b', 'a: b'], ['mein eigener Name', 'mein eigener Name'], ['', ''],
    ];
    for (const [name, want] of cases) assert.equal(stashLabel(name), want, name);
  });
});
