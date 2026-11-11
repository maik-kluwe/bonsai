import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { Scenario } from './scenario';
import { lines } from './helpers';

// README, "Resolve conflicts": a cherry-pick, a revert, a rebase and a stash can stop on a conflict, too. The banner names
// the operation and offers what fits it; the merge editor of VS Code is one click away.

let s: Scenario;
afterEach(() => s?.dispose());

/** a.txt with line 5 replaced. */
const setLine5 = (text: string) => { const a = lines(10).split('\n'); a[4] = text; s.h.t.write('a.txt', a.join('\n')); };
const line5 = () => readFileSync(path.join(s.h.t.dir, 'a.txt'), 'utf8').split('\n')[4];
const rowOf = (text: string) => `.row[data-i="${s.page.rows().findIndex(r => r.includes(text))}"]`;
const log = () => s.h.t.git('log', '--format=%s').trim().split('\n');

async function start(build: () => void) {
  s = new Scenario();
  build();
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
}

/** main and topic change line 5 differently; main is checked out. */
const twoBranches = () => start(() => {
  const { t } = s.h;
  t.write('a.txt', lines(10)); t.commit('base');
  t.git('checkout', '-q', '-b', 'topic'); setLine5('topic five'); t.commit('topic edits');
  t.git('checkout', '-q', 'main'); setLine5('main five'); t.commit('main edits');
});

const barButtons = () => [...s.page.document.querySelectorAll<HTMLButtonElement>('#mergebar button')].map(b => (b.textContent ?? '').trim());
async function bar(label: RegExp) {
  const b = [...s.page.document.querySelectorAll<HTMLButtonElement>('#mergebar button')].find(x => label.test(x.textContent ?? ''));
  assert.ok(b, `a button ${label} in the banner; it has: ${barButtons().join(', ')}`);
  b.click();
  await s.settle();
}
/** From the banner to the conflicted file in Local Changes. */
async function openConflictedFile() {
  await bar(/^Resolve/);
  await s.click('#unstaged li');
}
/** Take their side in the diff pane (the ticked pair is both, so untick ours first). */
async function takeTheirs() {
  await s.click('#diff [data-cside="ours"]');
  await s.click('#diff [data-file="resolveTheirs"]');
}

describe('a cherry-pick that stops on a conflict', () => {
  test('is named in the banner, and is finished by resolving and committing', async () => {
    await twoBranches();
    await s.rightClickAndChoose(rowOf('topic edits'), /^Cherry-pick/);
    assert.match(s.page.text('#mergebar'), /Cherry-picking commit '[0-9a-f]{7}'\. Fix 1 conflict/);
    assert.deepEqual(barButtons(), ['Resolve', 'Abort'], 'there is nothing to skip in a single pick');
    assert.equal(s.page.$('#conflictdlg').hidden, false);

    await openConflictedFile();
    await takeTheirs();
    assert.equal(line5(), 'topic five');
    await s.type('#c-subject', 'topic edits');
    await s.click('#c-commit');
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.deepEqual(log().slice(0, 2), ['topic edits', 'main edits']);
    assert.notEqual(s.h.t.tryGit('rev-parse', '--verify', '-q', 'CHERRY_PICK_HEAD').code, 0, 'no cherry-pick is running any more');
  });

  test('can be aborted, after a question', async () => {
    await twoBranches();
    await s.rightClickAndChoose(rowOf('topic edits'), /^Cherry-pick/);
    await bar(/^Abort/);
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')), 'it asks first');
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.equal(line5(), 'main five');
    assert.equal(s.h.t.git('status', '--porcelain'), '');
  });
});

describe('a revert that stops on a conflict', () => {
  test('is named in the banner, and aborting restores the branch', async () => {
    await start(() => {
      const { t } = s.h;
      t.write('a.txt', lines(10)); t.commit('base');
      setLine5('one'); t.commit('first edit');
      setLine5('two'); t.commit('second edit');
    });
    await s.rightClickAndChoose(rowOf('first edit'), /^Revert commit/);
    assert.match(s.page.text('#mergebar'), /Reverting commit '[0-9a-f]{7}'\. Fix 1 conflict/);
    assert.equal(s.page.$('#conflictdlg').hidden, false);
    assert.match(s.page.text('#conflictdlg'), /a\.txt/);

    await bar(/^Abort/);
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.equal(line5(), 'two');
    assert.equal(s.h.t.git('status', '--porcelain'), '');
  });
});

describe('a rebase that stops on a conflict', () => {
  test('counts the commits, offers Skip, and Continue goes on once the file is resolved', async () => {
    await twoBranches();
    await s.rightClickAndChoose('#refs .ref[data-name="topic"]', /^Rebase 'main' onto 'topic'/);
    assert.match(s.page.text('#mergebar'), /Rebasing 'main', commit 1 of 1\. Fix 1 conflict/);
    assert.deepEqual(barButtons(), ['Resolve', 'Skip', 'Abort']);

    await openConflictedFile();
    await takeTheirs();
    assert.ok(barButtons().includes('Continue'), `Continue appears when nothing is left: ${barButtons().join(', ')}`);
    await s.type('#c-subject', 'ignored');
    await s.click('#c-commit');
    assert.equal(log().includes('ignored'), false, 'the commit box does not commit during a rebase: Continue does');

    await bar(/^Continue/);
    assert.equal(s.page.$('#mergebar').hidden, true, 'the rebase is over');
    assert.deepEqual(log(), ['main edits', 'topic edits', 'base'], 'main sits on top of topic now');
  });

  test('can skip the commit that conflicts', async () => {
    await twoBranches();
    await s.rightClickAndChoose('#refs .ref[data-name="topic"]', /^Rebase 'main' onto 'topic'/);
    await bar(/^Skip/);
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.deepEqual(log(), ['topic edits', 'base'], 'main edits was left out');
  });

  test('can be aborted, and main is as before', async () => {
    await twoBranches();
    await s.rightClickAndChoose('#refs .ref[data-name="topic"]', /^Rebase 'main' onto 'topic'/);
    await bar(/^Abort/);
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')));
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.deepEqual(log(), ['main edits', 'base']);
  });
});

describe('a stash that stops on a conflict', () => {
  async function stashThatClashes() {
    await start(() => {
      const { t } = s.h;
      t.write('a.txt', lines(10)); t.commit('base');
      setLine5('stashed'); t.git('stash', 'push', '-q', '-m', 'parked');
      setLine5('committed'); t.commit('main edit');
    });
    await s.rightClickAndChoose('#refs .ref[data-kind="stash"]', /^Apply/);
  }

  test('says so in the banner, names the file, and the changes can be thrown away again', async () => {
    await stashThatClashes();
    assert.match(s.page.text('#mergebar'), /applying a stash\. Fix 1 conflict/);
    assert.equal(s.page.$('#conflictdlg').hidden, false);
    assert.match(s.page.text('#conflictdlg'), /a\.txt/);
    assert.deepEqual(barButtons(), ['Resolve', 'Discard all changes']);

    await bar(/^Discard all changes/);
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')), 'it asks first');
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.equal(line5(), 'committed');
    assert.match(s.h.t.git('stash', 'list'), /parked/, 'the stash itself is kept');
  });
});

describe('the merge editor of VS Code', () => {
  test('is one click away from a conflicted file', async () => {
    await twoBranches();
    await s.rightClickAndChoose(rowOf('topic edits'), /^Cherry-pick/);
    await openConflictedFile();
    await s.click('#diff [data-file="mergeEditor"]');
    assert.deepEqual(s.windowMessages.filter(m => m.type === 'mergeEditor'), [{ type: 'mergeEditor', path: 'a.txt' }]);
  });
});
