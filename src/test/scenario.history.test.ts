import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import { Scenario } from './scenario';

// README, "Follow the history": the graph with every kind of ref, the details of a commit, the filter and the sidebar.

let s: Scenario;
afterEach(() => s?.dispose());

/** main with a tag and a stash on it, and a branch feature/login that forked off earlier. */
async function repoWithEverything(opts: { logLimit?: number } = {}) {
  s = new Scenario(opts);
  const { t } = s.h;
  t.write('a.txt', 'one\n'); t.commit('first commit');
  t.git('checkout', '-q', '-b', 'feature/login');
  t.write('b.txt', 'login\n'); t.commit('add login');
  t.git('checkout', '-q', 'main');
  t.write('c.txt', 'more\n'); t.commit('main moves on');
  t.git('tag', 'v1.0');
  t.write('a.txt', 'changed\n'); t.git('stash', 'push', '-q', '-m', 'parked');
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
}

const row = (text: string) => s.page.rows().findIndex(r => r.includes(text));
const dimmed = () => [...s.page.document.querySelectorAll('.row.dim')].map(r => r.textContent ?? '');

describe('the graph and the sidebar show every kind of ref', () => {
  test('stash, tag, branches and the current branch are in the graph; the sidebar lists them as folders', async () => {
    await repoWithEverything();
    const rows = s.page.rows();
    assert.equal(rows.length, 4, 'three commits and the stash');
    assert.match(rows[0], /stash@\{0}.*parked/, 'a stash sits in the graph on the commit it was made on');
    assert.match(rows[1], /✓ ?main.*v1\.0.*main moves on/, 'the current branch is ticked, the tag is on its commit');
    assert.match(rows[2], /feature\/login.*add login/);

    const side = [...s.page.document.querySelectorAll('#refs .gtitle, #refs .frow, #refs .ref')].map(e => (e.textContent ?? '').trim());
    assert.deepEqual(side, ['Branches', 'feature', 'login', '✓main', 'Remotes', 'Tags', 'v1.0', 'Stashes', 'parked'],
      'feature/login sits inside the folder feature');
    assert.deepEqual(s.page.errors, []);
  });

  test('the box above the sidebar narrows it down', async () => {
    await repoWithEverything();
    await s.type('#ref-filter', 'login');
    const side = [...s.page.document.querySelectorAll('#refs .gtitle, #refs .ref')].map(e => (e.textContent ?? '').trim());
    assert.deepEqual(side, ['Branches', 'login']);
  });
});

describe('a commit', () => {
  test('shows its changed files and its message when clicked', async () => {
    await repoWithEverything();
    await s.click(`.row[data-i="${row('add login')}"]`);
    assert.match(s.page.text('#details'), /add login/);
    assert.match(s.page.text('#details'), /Test <test@example\.com>/);
    assert.match(s.page.text('#details'), /b\.txt/, 'the file the commit adds');
    assert.equal(s.page.$('#details').classList.contains('collapsed'), false);
  });
});

describe('the filter box', () => {
  test('dims what does not match the message, the author or the hash, and Enter jumps to the next match', async () => {
    await repoWithEverything();
    await s.type('#filter', 'login');
    assert.equal(dimmed().length, 3, 'only "add login" stays lit');
    assert.ok(!dimmed().some(r => r.includes('add login')));

    await s.type('#filter', '');
    assert.equal(dimmed().length, 0);

    const hash = s.h.t.git('rev-parse', '--short=7', 'feature/login').trim();
    await s.type('#filter', hash);
    assert.deepEqual(s.page.rows().filter((_, i) => !s.page.document.querySelectorAll('.row')[i].classList.contains('dim')).length, 1, 'by hash');

    await s.type('#filter', 'first');
    await s.key('#filter', 'Enter');
    assert.equal(s.page.sentOf('details').at(-1)?.hash, s.h.t.git('rev-list', '--max-parents=0', 'HEAD').trim(), 'Enter selects the match and asks for its details');
    assert.ok(s.page.$(`.row[data-i="${row('first commit')}"]`).classList.contains('selected'));
  });

  test('loads older commits while you search for one that is not in the list yet', async () => {
    s = new Scenario({ logLimit: 80 });
    // 150 commits in one go (git fast-import); the view only fetches more when it gets within 40 rows of the end
    const stream = Array.from({ length: 150 }, (_, i) => [
      'commit refs/heads/main', `committer T <t@example.com> ${1_700_000_000 + i * 60} +0000`,
      `data ${`commit number ${i + 1}`.length}`, `commit number ${i + 1}`,
      'M 644 inline f.txt', `data ${String(i).length}`, String(i),
    ].join('\n')).join('\n') + '\n';
    const imported = spawnSync('git', ['fast-import', '--quiet'], { cwd: s.h.t.dir, input: stream });
    assert.equal(imported.status, 0, String(imported.stderr));
    s.h.t.git('reset', '-q', '--hard');
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');
    assert.equal(s.page.sentOf('loadMore').length, 0, 'the first page is enough for the window');
    assert.equal(s.limit, 80);
    assert.ok(!s.page.rows().some(r => r.includes('commit number 1 ')), 'the oldest commit is not loaded');

    await s.type('#filter', 'number 1');
    assert.ok(s.page.sentOf('loadMore').length > 0, 'the view asks for more as soon as a filter is set');
    const data = s.h.posted.filter(m => m.type === 'data').at(-1);
    assert.ok(data?.type === 'data' && data.commits.length === 150 && !data.more, 'and goes on until the whole history is there');
  });
});
