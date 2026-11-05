import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createNav, WORKTREE }: { createNav(deps: any): any; WORKTREE: string } = require('../../media/nav.js');

const commit = (hash: string, extra = {}) => ({ hash, subject: `subject ${hash}`, author: 'Ann', parents: [], ...extra });
const packet = (commits: any[], extra = {}) => ({ commits, rows: [], refs: [], maxWidth: 0, staged: [], unstaged: [], ...extra });
const ref = (kind: string, name: string, hash: string, extra = {}) => ({ kind, name, hash, ...extra });

function setup(saved?: any) {
  const sent: any[] = [];
  const saves: any[] = [];
  const asked: [string, boolean][] = [];
  let cleared = 0;
  const pane = { hash: '', want(h: string, stash: boolean) { this.hash = h; asked.push([h, stash]); }, clear() { this.hash = ''; cleared++; } };
  const nav = createNav({ post: (m: any) => sent.push(m), pane, saved, save: (st: any) => saves.push(st) });
  return { nav, sent, saves, asked, pane, cleared: () => cleared };
}

describe('nav: data and selection', () => {
  test('selecting a commit asks the details pane for it; a stash row says so', () => {
    const { nav, asked } = setup();
    nav.receive(packet([commit('a'), commit('b', { stash: 0 })]));
    assert.equal(nav.select(0), 'commit');
    assert.equal(nav.select(1), 'commit');
    assert.deepEqual(asked, [['a', false], ['b', true]]);
    assert.equal(nav.selected, 1);
  });

  test('the row of the uncommitted changes has no details', () => {
    const { nav, asked, cleared } = setup();
    nav.receive(packet([commit(WORKTREE), commit('a')]));
    assert.equal(nav.select(0), 'worktree');
    assert.deepEqual(asked, []);
    assert.equal(cleared(), 1);
    assert.equal(nav.onWorktree, true);
    nav.select(1);
    assert.equal(nav.onWorktree, false);
  });

  test('a position outside the list selects nothing', () => {
    const { nav } = setup();
    nav.receive(packet([commit('a')]));
    assert.equal(nav.select(-1), null);
    assert.equal(nav.select(1), null);
    assert.equal(nav.selected, -1);
  });

  test('a new data packet keeps the selected commit wherever it is now, and leaves nothing selected when it is gone', () => {
    for (const [name, before, row, after, want] of [
      ['moved', ['a', 'b'], 1, ['new', 'a', 'b'], 2],
      ['gone', ['a'], 0, ['z'], -1],
    ] as const) {
      const { nav } = setup();
      nav.receive(packet(before.map(h => commit(h))));
      nav.select(row);
      nav.receive(packet(after.map(h => commit(h))));
      assert.equal(nav.selected, want, name);
      assert.equal(nav.indexOf(before[row]), want < 0 ? undefined : want, name);
    }
  });

  test('without a selection the details go, unless the pane shows a ref', () => {
    const { nav, pane } = setup();
    nav.receive(packet([commit('a')], { refs: [ref('stash', 'stash@{0}', 's1')] }));
    pane.hash = 'gone';
    assert.equal(nav.detailsGone(), true);
    pane.hash = 's1';
    assert.equal(nav.detailsGone(), false);
    nav.select(0);
    pane.hash = 'gone';
    assert.equal(nav.detailsGone(), false);
  });

  test('arrow keys stop at the ends', () => {
    const { nav } = setup();
    nav.receive(packet([commit('a'), commit('b')]));
    assert.equal(nav.target(-1), 0);
    nav.select(0);
    assert.equal(nav.target(-1), 0);
    assert.equal(nav.target(1), 1);
    nav.select(1);
    assert.equal(nav.target(1), 1);
  });

  test('a stash that is not in the log is shown by its hash, with no row selected', () => {
    const { nav, asked } = setup();
    nav.receive(packet([commit('a')]));
    nav.select(0);
    nav.showStash('s1');
    assert.equal(nav.selected, -1);
    assert.deepEqual(asked[asked.length - 1], ['s1', true]);
  });
});

describe('nav: refs', () => {
  const refs = [
    ref('head', 'main', 'a'), ref('head', 'feat/x', 'b'), ref('remote', 'origin/main', 'a'),
    ref('tag', 'v1', 'a'), ref('stash', 'stash@{0}', 's'),
  ];

  test('refs are found by the commit they point at, stashes aside', () => {
    const { nav } = setup();
    nav.receive(packet([commit('a')], { refs }));
    assert.deepEqual(nav.refsAt('a').map((r: any) => r.name), ['main', 'origin/main', 'v1']);
    assert.deepEqual(nav.refsAt('s'), []);
    assert.deepEqual(nav.refsAt('unknown'), []);
  });

  test('the sidebar filter narrows each kind, ignoring case and spaces around', () => {
    const { nav } = setup();
    nav.receive(packet([], { refs }));
    assert.equal(nav.refsOfKind('head').length, 2);
    nav.setRefFilter('  FEAT ');
    assert.deepEqual(nav.refsOfKind('head').map((r: any) => r.name), ['feat/x']);
    assert.deepEqual(nav.refsOfKind('remote'), []);
    assert.equal(nav.refFilter, 'feat');
  });

  test('tags start collapsed, everything else open; the choice is kept', () => {
    const { nav, saves } = setup();
    assert.equal(nav.groupOpen('Tags'), false);
    assert.equal(nav.groupOpen('Branches'), true);
    assert.equal(nav.folderOpen('Remotes/origin'), false);
    assert.equal(nav.toggle('group', 'Tags'), true);
    assert.equal(nav.toggle('folder', 'Remotes/origin'), true);
    assert.equal(nav.groupOpen('Tags'), true);
    assert.equal(nav.folderOpen('Remotes/origin'), true);
    assert.deepEqual(saves[saves.length - 1], { collapsed: [], expanded: ['Remotes/origin'] });
  });

  test('what the view kept is taken over', () => {
    const { nav } = setup({ collapsed: ['Branches'], expanded: ['Remotes/origin'] });
    assert.equal(nav.groupOpen('Branches'), false);
    assert.equal(nav.groupOpen('Tags'), true);
    assert.equal(nav.folderOpen('Remotes/origin'), true);
  });

  test('while filtering everything is open and clicks change nothing', () => {
    const { nav, saves } = setup();
    nav.setRefFilter('x');
    assert.equal(nav.groupOpen('Tags'), true);
    assert.equal(nav.folderOpen('any'), true);
    assert.equal(nav.toggle('group', 'Tags'), false);
    assert.deepEqual(saves, []);
    nav.setRefFilter('');
    assert.equal(nav.groupOpen('Tags'), false);
  });
});

describe('nav: commit filter', () => {
  const commits = [commit(WORKTREE), commit('abc123', { subject: 'Fix bug', author: 'Ann' }), commit('def456', { subject: 'Add feature', author: 'Bob' }), commit('abd789', { subject: 'Fix typo', author: 'Cy' })];

  test('everything passes without a filter; the worktree row always does', () => {
    const { nav } = setup();
    assert.equal(nav.matches(commits[2]), true);
    nav.setFilter('zzz');
    assert.equal(nav.matches(commits[0]), true);
    assert.equal(nav.matches(commits[2]), false);
  });

  test('subject, author and the start of the hash are searched, ignoring case', () => {
    const { nav } = setup();
    nav.setFilter(' FIX ');
    assert.deepEqual(commits.map(c => nav.matches(c)), [true, true, false, true]);
    nav.setFilter('bob');
    assert.deepEqual(commits.map(c => nav.matches(c)), [true, false, true, false]);
    nav.setFilter('abd');
    assert.deepEqual(commits.map(c => nav.matches(c)), [true, false, false, true]);
  });

  test('Enter finds the next match after the selection, Shift+Enter the previous, both wrapping around', () => {
    const { nav } = setup();
    nav.receive(packet(commits));
    nav.setFilter('fix');
    nav.select(1);
    assert.equal(nav.findMatch(false), 3);
    nav.select(3);
    assert.equal(nav.findMatch(false), 0); // the worktree row always matches
    nav.select(1);
    assert.equal(nav.findMatch(true), 0);
    nav.setFilter('nothing here');
    assert.equal(nav.findMatch(false), 0);
    const empty = setup();
    empty.nav.receive(packet([]));
    assert.equal(empty.nav.findMatch(false), -1);
  });
});

describe('nav: loading more commits', () => {
  const port = (scrollTop: number) => ({ scrollTop, clientHeight: 500, scrollHeight: 24 * 1000, rowH: 24 });

  test('nothing is asked for when there are no more, or the list is far from its end', () => {
    const { nav, sent } = setup();
    nav.receive(packet([commit('a')], { more: false }));
    nav.loadMoreIfNeeded(port(24 * 1000));
    nav.receive(packet([commit('a')], { more: true }));
    nav.loadMoreIfNeeded(port(0));
    assert.deepEqual(sent, []);
  });

  test('near the end the host is asked once until the next data packet', () => {
    const { nav, sent } = setup();
    nav.receive(packet([commit('a')], { more: true }));
    nav.loadMoreIfNeeded(port(24 * 1000 - 500));
    nav.loadMoreIfNeeded(port(24 * 1000 - 500));
    assert.deepEqual(sent, [{ type: 'loadMore' }]);
    nav.receive(packet([commit('a')], { more: true }));
    nav.loadMoreIfNeeded(port(24 * 1000 - 500));
    assert.equal(sent.length, 2);
  });

  test('an error ends the wait too', () => {
    const { nav, sent } = setup();
    nav.receive(packet([commit('a')], { more: true }));
    nav.loadMoreIfNeeded(port(24 * 1000 - 500));
    nav.failed();
    nav.loadMoreIfNeeded(port(24 * 1000 - 500));
    assert.equal(sent.length, 2);
  });

  test('while a filter is active the whole history is fetched, wherever the list is scrolled to', () => {
    const { nav, sent } = setup();
    nav.receive(packet([commit('a')], { more: true }));
    nav.setFilter('x');
    nav.loadMoreIfNeeded(port(0));
    assert.deepEqual(sent, [{ type: 'loadMore' }]);
  });
});
