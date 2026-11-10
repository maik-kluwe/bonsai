import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import {
  MERGE_OPTIONS, apiErrorMessage, cherryPickArgs, mergeArgs, parsePreview, previewArgs, rebaseArgs, revertArgs, unsupportedWithConflicts,
} from '../operations';

describe('mergeArgs', () => {
  test('each option maps to its Git flag', () => {
    assert.deepEqual(mergeArgs('feat', 'default'), ['merge', '--no-edit', 'feat']);
    assert.deepEqual(mergeArgs('feat', 'noFf'), ['merge', '--no-ff', '--no-edit', 'feat']);
    assert.deepEqual(mergeArgs('feat', 'squash'), ['merge', '--squash', 'feat']);
    assert.deepEqual(mergeArgs('feat', 'noCommit'), ['merge', '--no-commit', 'feat']);
  });
});

describe('cherryPickArgs / revertArgs', () => {
  test('commit and append-origin combinations', () => {
    assert.deepEqual(cherryPickArgs('h', { commit: true, appendOrigin: false }), ['cherry-pick', 'h']);
    assert.deepEqual(cherryPickArgs('h', { commit: false, appendOrigin: false }), ['cherry-pick', '-n', 'h']);
    assert.deepEqual(cherryPickArgs('h', { commit: true, appendOrigin: true }), ['cherry-pick', '-x', 'h']);
    assert.deepEqual(cherryPickArgs('h', { commit: false, appendOrigin: true }), ['cherry-pick', '-n', '-x', 'h']);
  });

  test('revert never opens an editor', () => {
    assert.deepEqual(revertArgs('h', { commit: true }), ['revert', '--no-edit', 'h']);
    assert.deepEqual(revertArgs('h', { commit: false }), ['revert', '--no-edit', '--no-commit', 'h']);
  });
});

describe('previewArgs', () => {
  const flags = ['merge-tree', '--write-tree', '--name-only', '--no-messages'];

  test('merge previews HEAD against the commit, cherry-pick uses the parent as merge base, revert swaps base and tip', () => {
    assert.deepEqual(previewArgs('merge', 'h'), [...flags, 'HEAD', 'h'], 'merge');
    assert.deepEqual(previewArgs('cherryPick', 'h'), [...flags, '--merge-base=h^', 'HEAD', 'h'], 'cherry-pick');
    assert.deepEqual(previewArgs('revert', 'h'), [...flags, '--merge-base=h', 'HEAD', 'h^'], 'revert');
  });
});

describe('parsePreview', () => {
  test('the paths after the tree id, once each, with any line ending', () => {
    const cases: [string, string, string[]][] = [
      ['clean', '4b825dc642cb6eb9a060e54bf8d69288fbee4904\n', []],
      ['conflicts, duplicates collapse', 'abc123\na.txt\ndir/b.txt\na.txt\n', ['a.txt', 'dir/b.txt']],
      ['CRLF and blank lines', 'abc123\r\na.txt\r\n\r\n', ['a.txt']],
    ];
    for (const [name, output, want] of cases) assert.deepEqual(parsePreview(output), want, name);
  });
});

describe('unsupportedWithConflicts', () => {
  test('only what Bonsai could not show or abort is refused with conflicts: squash and a cherry-pick without commit', () => {
    for (const option of MERGE_OPTIONS) assert.equal(unsupportedWithConflicts({ kind: 'merge', option }, []), false, `no conflicts: ${option}`);
    for (const kind of ['cherryPick', 'revert'] as const) {
      for (const commit of [true, false]) assert.equal(unsupportedWithConflicts({ kind, commit }, []), false, `no conflicts: ${kind}, commit ${commit}`);
    }
    // MERGE_HEAD lets Bonsai show and abort a merge; -n leaves no CHERRY_PICK_HEAD; --no-commit keeps REVERT_HEAD
    assert.equal(unsupportedWithConflicts({ kind: 'merge', option: 'default' }, ['a']), false, 'merge default');
    assert.equal(unsupportedWithConflicts({ kind: 'merge', option: 'noFf' }, ['a']), false, 'merge noFf');
    assert.equal(unsupportedWithConflicts({ kind: 'merge', option: 'noCommit' }, ['a']), false, 'merge noCommit');
    assert.equal(unsupportedWithConflicts({ kind: 'merge', option: 'squash' }, ['a']), true, 'merge squash');
    assert.equal(unsupportedWithConflicts({ kind: 'cherryPick', commit: true }, ['a']), false, 'cherry-pick with commit');
    assert.equal(unsupportedWithConflicts({ kind: 'cherryPick', commit: false }, ['a']), true, 'cherry-pick without commit');
    assert.equal(unsupportedWithConflicts({ kind: 'revert', commit: true }, ['a']), false, 'revert with commit');
    assert.equal(unsupportedWithConflicts({ kind: 'revert', commit: false }, ['a']), false, 'revert without commit');
  });
});

describe('rebaseArgs', () => {
  test('autostash is optional, the target comes last', () => {
    assert.deepEqual(rebaseArgs('main', { autostash: false }), ['rebase', 'main']);
    assert.deepEqual(rebaseArgs('main', { autostash: true }), ['rebase', '--autostash', 'main']);
  });
});

describe('replaySteps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { replaySteps } = require('../operations') as typeof import('../operations');

  test('counts the commits to replay, not the todo lines', () => {
    const cases: [string, string, string, { step: number; total: number }][] = [
      ['todo lines that replay nothing', 'drop aaa c1\npick bbb c2\nexec git commit --amend -F x\npick ccc c3\n', 'fixup ddd c4\nexec git commit --amend -F y\n# a comment\n\ndrop eee c5\npick fff c6\n', { step: 2, total: 4 }],
      ['short forms and the variants of fixup', 'p a\nr b\n', 'e c\ns d\nf e\nfixup -C f\nfixup -c g\nd h\nx cmd\n', { step: 2, total: 7 }],
      ['nothing done yet', '', 'pick a\npick b\n', { step: 0, total: 2 }],
      ['nothing left', 'pick a\n', '', { step: 1, total: 1 }],
      ['nothing at all', '', '', { step: 0, total: 0 }],
      ['only starts like a replay word', '', 'picked a\nexec pick\nreset onto\nlabel p\n', { step: 0, total: 0 }],
    ];
    for (const [name, done, todo, want] of cases) assert.deepEqual(replaySteps(done, todo), want, name);
  });
});

describe('apiErrorMessage', () => {
  test('the Git extension only says "Failed to execute git"; the reason is what Git printed', () => {
    const e = Object.assign(new Error('Failed to execute git'), {
      stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\ta.txt\nPlease commit your changes or stash them before you merge.\nAborting\n',
      stdout: '',
    });
    assert.equal(apiErrorMessage(e), 'error: Your local changes to the following files would be overwritten by merge:\n\ta.txt\nPlease commit your changes or stash them before you merge.\nAborting');
  });

  test('stdout where stderr is empty (Git reports conflicts there), the message where Git printed nothing, any value at all', () => {
    assert.equal(apiErrorMessage(Object.assign(new Error('Failed to execute git'), { stderr: ' \n', stdout: 'CONFLICT (content): Merge conflict in a.txt\n' })), 'CONFLICT (content): Merge conflict in a.txt');
    assert.equal(apiErrorMessage(new Error('boom')), 'boom');
    assert.equal(apiErrorMessage('plain'), 'plain');
    assert.equal(apiErrorMessage(undefined), 'undefined');
  });

  test('progress lines in front of the reason are dropped when there are many', () => {
    const progress = Array.from({ length: 30 }, (_, i) => `remote: Counting objects: ${i}%`);
    const out = apiErrorMessage({ stderr: [...progress, 'fatal: unable to access', 'The requested URL returned error: 403'].join('\n') }, 3);
    assert.equal(out, 'remote: Counting objects: 29%\nfatal: unable to access\nThe requested URL returned error: 403');
  });
});
