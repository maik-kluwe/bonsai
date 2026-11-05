import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { RS, US, parseCommitMeta, parseLog, parseNameStatus, parseRefs, parseStashList } from '../gitParse';

describe('parseLog', () => {
  test('reads one commit per record and splits the parents', () => {
    const out = [
      ['h2', 'h1', 'Ann', 'a@x', '200', 'second'].join(US) + RS + '\n',
      ['h1', '', 'Bob', 'b@x', '100', 'first'].join(US) + RS + '\n',
    ].join('');
    assert.deepEqual(parseLog(out), [
      { hash: 'h2', parents: ['h1'], author: 'Ann', email: 'a@x', date: 200, subject: 'second' },
      { hash: 'h1', parents: [], author: 'Bob', email: 'b@x', date: 100, subject: 'first' },
    ]);
  });

  test('an empty log is an empty list', () => assert.deepEqual(parseLog(''), []));
});

describe('parseRefs', () => {
  const line = (...f: string[]) => f.join(US);

  test('maps heads, remotes and tags; hides origin/HEAD; peels annotated tags', () => {
    const out = [
      line('refs/heads/main', 'aaa', '', 'origin/main', 'ahead 2, behind 1'),
      line('refs/remotes/origin/main', 'bbb', '', '', ''),
      line('refs/remotes/origin/HEAD', 'bbb', '', '', ''),
      line('refs/tags/v1', 'ttt', 'ccc', '', ''),
      line('refs/tags/v2', 'ddd', '', '', ''),
    ].join('\n') + '\n';
    assert.deepEqual(parseRefs(out), [
      { name: 'main', kind: 'head', hash: 'aaa', upstream: 'origin/main', ahead: 2, behind: 1, gone: false },
      { name: 'origin/main', kind: 'remote', hash: 'bbb' },
      { name: 'v1', kind: 'tag', hash: 'ccc' },
      { name: 'v2', kind: 'tag', hash: 'ddd' },
    ]);
  });

  test('an upstream whose branch was deleted counts as gone', () => {
    const [r] = parseRefs(line('refs/heads/x', 'aaa', '', 'origin/x', 'gone') + '\n');
    assert.equal(r.upstream, 'origin/x');
    assert.equal(r.gone, true);
    assert.equal(r.ahead, 0);
  });

  test('a branch without upstream has no counts', () => {
    const [r] = parseRefs(line('refs/heads/x', 'aaa', '', '', '') + '\n');
    assert.equal(r.upstream, undefined);
    assert.equal(r.ahead, 0);
    assert.equal(r.behind, 0);
  });
});

describe('parseStashList', () => {
  test('reads index, base commit and the label without the Git prefix', () => {
    const out = ['stash@{1}', 'sss', 'On main: work', 'base other', '300', 'Ann', 'a@x'].join(US) + '\n';
    assert.deepEqual(parseStashList(out), [{
      name: 'On main: work', label: 'work', kind: 'stash', hash: 'sss', index: 1, parent: 'base', date: 300, author: 'Ann', email: 'a@x',
    }]);
  });
});

describe('parseNameStatus', () => {
  test('renames and copies carry both paths', () => {
    const out = ['M', 'a.ts', 'R100', 'old.ts', 'new.ts', 'A', 'b.ts', 'D', 'c.ts', ''].join('\0');
    assert.deepEqual(parseNameStatus(out), [
      { status: 'M', path: 'a.ts' },
      { status: 'R', oldPath: 'old.ts', path: 'new.ts' },
      { status: 'A', path: 'b.ts' },
      { status: 'D', path: 'c.ts' },
    ]);
  });
});

describe('parseCommitMeta', () => {
  test('trims the body and treats a root commit as parentless', () => {
    const out = ['h', '', 'Ann', 'a@x', '100', 'Cee', '110', 'subj', 'body\n\n'].join(US);
    assert.deepEqual(parseCommitMeta(out), {
      hash: 'h', parents: [], author: 'Ann', email: 'a@x', date: 100, committer: 'Cee', committerDate: 110, subject: 'subj', body: 'body',
    });
  });
});
