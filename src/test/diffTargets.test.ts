import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { EMPTY_TREE, changeView, commitDiffRefs } from '../diffTargets';
import { Status } from '../git';

describe('commitDiffRefs', () => {
  test('parent against commit; empty tree for what is not there; base and target win', () => {
    const c = { hash: 'h1', parent: 'p1' };
    assert.deepEqual(commitDiffRefs(c), { left: 'p1', right: 'h1' }, 'a commit is compared with its parent');
    assert.deepEqual(commitDiffRefs({ hash: 'h1' }), { left: EMPTY_TREE, right: 'h1' }, 'root commit');
    assert.deepEqual(commitDiffRefs({ ...c, base: 'b', target: 't' }), { left: 'b', right: 't' }, 'base and target');
    assert.deepEqual(commitDiffRefs({ ...c, status: 'A' }), { left: EMPTY_TREE, right: 'h1' }, 'added file');
    assert.deepEqual(commitDiffRefs({ ...c, status: 'D' }), { left: 'p1', right: EMPTY_TREE }, 'deleted file');
  });
});

describe('changeView', () => {
  test('which two sides a change compares, and that conflicts open as a file', () => {
    assert.deepEqual(changeView(Status.INDEX_MODIFIED, true), { left: { file: 'original', ref: 'HEAD' }, right: { file: 'current', ref: '' }, title: 'diffStaged' }, 'staged: HEAD with the index');
    assert.deepEqual((changeView(Status.INDEX_ADDED, true) as any).left, { file: 'current', ref: EMPTY_TREE }, 'staged new file');
    assert.deepEqual((changeView(Status.INDEX_DELETED, true) as any).right, { file: 'current', ref: EMPTY_TREE }, 'staged deletion');
    assert.deepEqual(changeView(Status.MODIFIED, false), { left: { file: 'current', ref: '~' }, right: { file: 'current' }, title: 'diffWorking' }, 'modified: index with working tree');
    assert.equal((changeView(Status.TYPE_CHANGED, false) as any).title, 'diffWorking', 'type change');
    assert.deepEqual(changeView(Status.DELETED, false), { left: { file: 'current', ref: '~' }, right: { file: 'current', ref: EMPTY_TREE }, title: 'diffDeleted' }, 'deleted');
    for (const s of [Status.UNTRACKED, Status.INTENT_TO_ADD]) {
      assert.deepEqual(changeView(s, false), { left: { file: 'current', ref: EMPTY_TREE }, right: { file: 'current' }, title: 'diffNew' }, `new file ${s}`);
    }
    assert.deepEqual(changeView(Status.BOTH_MODIFIED, false), { open: true }, 'conflict');
  });
});
