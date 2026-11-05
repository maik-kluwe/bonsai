import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { mergeInfo } from '../snapshot';
import { en, de } from '../i18n';

type Kind = 'merge' | 'cherryPick' | 'revert' | 'rebase' | 'conflicts';
interface M { kind: Kind; theirs: string; conflicts: number; rebase?: { branch: string; step: number; total: number } }
const { mergeBanner }: {
  mergeBanner(m: M, branch?: string): { what: (string | number)[]; todo: (string | number)[]; buttons: { action: string; label: string }[] };
} = require('../../media/mergebar.js');

const m = (kind: Kind, conflicts: number, extra: Partial<M> = {}): M => ({ kind, theirs: 'feat', conflicts, ...extra });
const actions = (x: M) => mergeBanner(x, 'main').buttons.map(b => b.action);

describe('mergeBanner', () => {
  test('says what is running, with the names it needs', () => {
    assert.deepEqual(mergeBanner(m('merge', 1), 'main').what, ['mergingInto', 'feat', 'main']);
    assert.deepEqual(mergeBanner(m('merge', 1)).what, ['mergingInto', 'feat', 'HEAD']);
    assert.deepEqual(mergeBanner(m('cherryPick', 1)).what, ['cherryPickingCommit', 'feat']);
    assert.deepEqual(mergeBanner(m('revert', 1)).what, ['revertingCommit', 'feat']);
    assert.deepEqual(mergeBanner(m('conflicts', 1)).what, ['conflictsOpen']);
    assert.deepEqual(mergeBanner(m('rebase', 1, { rebase: { branch: 'b', step: 2, total: 3 } })).what, ['rebasingBranch', 'b', 2, 3]);
    assert.deepEqual(mergeBanner(m('rebase', 1)).what, ['rebasingBare']);
  });

  test('says what is left to do: one, many, or all resolved in the words of the operation', () => {
    assert.deepEqual(mergeBanner(m('merge', 1)).todo, ['mergeFixOne']);
    assert.deepEqual(mergeBanner(m('merge', 4)).todo, ['mergeFixMany', 4]);
    assert.deepEqual(mergeBanner(m('merge', 0)).todo, ['mergeAllResolved']);
    assert.deepEqual(mergeBanner(m('rebase', 0)).todo, ['rebaseAllResolved']);
    assert.deepEqual(mergeBanner(m('revert', 0)).todo, ['opAllResolved']);
  });

  test('offers Resolve while conflicts are open, Continue and Skip only in a rebase, Abort always', () => {
    assert.deepEqual(actions(m('merge', 2)), ['resolve', 'abort']);
    assert.deepEqual(actions(m('merge', 0)), ['abort']);
    assert.deepEqual(actions(m('rebase', 2)), ['resolve', 'skip', 'abort']);
    assert.deepEqual(actions(m('rebase', 0)), ['continue', 'skip', 'abort']);
  });

  test('conflicts without an operation can only be thrown away, and the button says so', () => {
    assert.deepEqual(mergeBanner(m('conflicts', 2)).buttons.at(-1), { action: 'abort', label: 'discardAllBtn' });
    assert.deepEqual(mergeBanner(m('merge', 2)).buttons.at(-1), { action: 'abort', label: 'abort' });
  });

  test('every text it names exists in both languages', () => {
    const keys = new Set<string>();
    for (const kind of ['merge', 'cherryPick', 'revert', 'rebase', 'conflicts'] as Kind[]) {
      for (const n of [0, 1, 3]) {
        for (const x of [m(kind, n), m(kind, n, { rebase: { branch: 'b', step: 1, total: 2 } })]) {
          const b = mergeBanner(x);
          keys.add(String(b.what[0])); keys.add(String(b.todo[0]));
          b.buttons.forEach(btn => keys.add(btn.label));
        }
      }
    }
    for (const k of keys) {
      assert.ok(k in en, `${k} missing in en`);
      assert.ok(k in de, `${k} missing in de`);
    }
  });

  test('takes what mergeInfo produces, for a marker and for conflicts without one', () => {
    const withMarker = mergeInfo({ kind: 'cherryPick', theirs: 'abc1234', hash: 'abc', message: '' }, 1, 'incoming')!;
    const bare = mergeInfo(undefined, 2, 'incoming')!;
    assert.deepEqual(mergeBanner(withMarker).what, ['cherryPickingCommit', 'abc1234']);
    assert.deepEqual(mergeBanner(bare).what, ['conflictsOpen']);
  });
});
