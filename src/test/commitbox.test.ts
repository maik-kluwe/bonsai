import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

type Fields = { subject: string; body: string };
type State = { message: string; amend: boolean; staged: number; merge?: { conflicts: number; kind?: string } };
interface Prefill { update(merge: { hash: string; message: string } | undefined, fields: Fields): Fields | null }
const { splitMessage, joinMessage, commitBlocker, createPrefill }: {
  splitMessage(m: string): Fields;
  joinMessage(subject: string, body: string): string;
  commitBlocker(s: State): null | 'rebasing' | 'noMessage' | 'conflicts' | 'nothingStaged';
  createPrefill(): Prefill;
} = require('../../media/commitbox.js');

describe('splitMessage / joinMessage', () => {
  test('splits subject from body and trims the body; a single line has an empty body', () => {
    assert.deepEqual(splitMessage('subj\n\n  body line 1\nline 2\n\n'), { subject: 'subj', body: 'body line 1\nline 2' });
    assert.deepEqual(splitMessage('only subject'), { subject: 'only subject', body: '' });
  });

  test('join puts a blank line between subject and body and none without a body', () => {
    assert.equal(joinMessage('s', 'b'), 's\n\nb');
    assert.equal(joinMessage('s', '  \n '), 's');
    assert.equal(joinMessage('  s ', ' b '), 's\n\nb');
  });

  test('join(split(x)) is stable for normalized messages', () => {
    for (const m of ['s', 's\n\nb', 's\n\nb1\nb2']) {
      const { subject, body } = splitMessage(m);
      assert.equal(joinMessage(subject, body), m);
    }
  });
});

describe('commitBlocker', () => {
  const ok = (over: Partial<State> = {}): State => ({ message: 'msg', amend: false, staged: 1, ...over });

  test('allows a commit with a message and staged changes', () => {
    assert.equal(commitBlocker(ok()), null);
  });

  test('blank subject blocks, even with a body', () => {
    assert.equal(commitBlocker(ok({ message: '' })), 'noMessage');
    assert.equal(commitBlocker(ok({ message: '   ' })), 'noMessage');
    assert.equal(commitBlocker(ok({ message: '\n\nbody only' })), 'noMessage');
  });

  test('nothing staged blocks, unless amending', () => {
    assert.equal(commitBlocker(ok({ staged: 0 })), 'nothingStaged');
    assert.equal(commitBlocker(ok({ staged: 0, amend: true })), null);
  });

  test('during a merge, cherry-pick or revert only open conflicts block; staged count and amend are irrelevant', () => {
    for (const kind of [undefined, 'merge', 'cherryPick', 'revert']) {
      assert.equal(commitBlocker(ok({ staged: 0, merge: { conflicts: 2, kind } })), 'conflicts', kind);
      assert.equal(commitBlocker(ok({ staged: 5, merge: { conflicts: 1, kind } })), 'conflicts', kind);
      assert.equal(commitBlocker(ok({ staged: 0, merge: { conflicts: 0, kind } })), null, kind);
    }
  });

  test('during a rebase the commit box never commits: Continue does', () => {
    for (const conflicts of [0, 2]) assert.equal(commitBlocker(ok({ merge: { conflicts, kind: 'rebase' } })), 'rebasing');
    assert.equal(commitBlocker(ok({ message: '', merge: { conflicts: 0, kind: 'rebase' } })), 'rebasing');
  });

  test('a missing message wins over conflicts', () => {
    assert.equal(commitBlocker(ok({ message: '', merge: { conflicts: 3 } })), 'noMessage');
  });
});

describe('createPrefill', () => {
  const empty: Fields = { subject: '', body: '' };
  const merge = (hash = 'h1', message = "Merge branch 'x'\n\ndetails") => ({ hash, message });

  test('fills empty fields once per merge', () => {
    const p = createPrefill();
    assert.deepEqual(p.update(merge(), empty), { subject: "Merge branch 'x'", body: 'details' });
    assert.equal(p.update(merge(), empty), null, 'second update for the same merge must not refill');
  });

  test('never overwrites what the user already typed', () => {
    const p = createPrefill();
    assert.equal(p.update(merge(), { subject: 'mine', body: '' }), null);
    assert.equal(p.update(merge(), empty), null, 'the merge counts as handled, the field belongs to the user');
  });

  test('clears the pre-filled text when the merge ends unchanged', () => {
    const p = createPrefill();
    const filled = p.update(merge(), empty)!;
    assert.deepEqual(p.update(undefined, filled), empty);
  });

  test('keeps the text when the merge ends and the user edited it', () => {
    const p = createPrefill();
    const filled = p.update(merge(), empty)!;
    assert.equal(p.update(undefined, { ...filled, subject: filled.subject + ' (edited)' }), null);
  });

  test('does nothing without a merge', () => {
    assert.equal(createPrefill().update(undefined, { subject: 'x', body: '' }), null);
  });

  test('a new merge is pre-filled again after the previous one ended', () => {
    const p = createPrefill();
    const filled = p.update(merge('h1'), empty)!;
    p.update(undefined, filled);
    assert.deepEqual(p.update(merge('h2', 'second'), empty), { subject: 'second', body: '' });
  });

  test('a merge without MERGE_MSG fills nothing and does not clear later input', () => {
    const p = createPrefill();
    assert.equal(p.update(merge('h1', ''), empty), null);
    assert.equal(p.update(undefined, { subject: 'typed', body: '' }), null);
  });
});
