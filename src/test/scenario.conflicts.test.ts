import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { Scenario } from './scenario';
import { lines } from './helpers';

// README, "Resolve conflicts": the dry run before a merge, the banner, the merge dialog, resolving with one side, aborting.

let s: Scenario;
afterEach(() => s?.dispose());

/** main and topic change line 5 of a.txt differently. */
async function twoBranchesThatClash() {
  s = new Scenario();
  const { t } = s.h;
  t.write('a.txt', lines(10)); t.commit('base');
  t.git('checkout', '-q', '-b', 'topic');
  const topic = lines(10).split('\n'); topic[4] = 'topic five'; t.write('a.txt', topic.join('\n')); t.commit('topic edits');
  t.git('checkout', '-q', 'main');
  const main = lines(10).split('\n'); main[4] = 'main five'; t.write('a.txt', main.join('\n')); t.commit('main edits');
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
}

/** Merge topic into main from the context menu of the branch. */
async function mergeTopic() {
  await s.rightClick('#refs .ref[data-name="topic"]');
  const entry = [...s.page.document.querySelectorAll<HTMLElement>('#menu .mi')].find(e => /^Merge into/.test(e.textContent ?? ''));
  assert.ok(entry, 'the branch menu offers a merge');
  await s.click(`#menu .mi[data-i="${entry.dataset.i}"]`);
}

const content = () => readFileSync(path.join(s.h.t.dir, 'a.txt'), 'utf8').split('\n')[4];
/** The banner, and the dialog's resolve step: from the merge to the file in Local Changes. */
async function openConflictedFile() {
  await s.click('#mergebar button');
  await s.click('#unstaged li');
}

describe('before a merge', () => {
  test('a dry run names the files that would conflict, and squash is not offered then', async () => {
    await twoBranchesThatClash();
    await mergeTopic();
    assert.match(s.h.ui.pickOptions.placeHolder ?? '', /Conflicts expected in: a\.txt/);
    assert.ok(!s.h.ui.offered.some(o => /squash/i.test(o)), `offered: ${s.h.ui.offered}`);
  });

  test('a clean merge says nothing about conflicts and just goes through', async () => {
    s = new Scenario();
    const { t } = s.h;
    t.write('a.txt', lines(10)); t.commit('base');
    t.git('checkout', '-q', '-b', 'topic'); t.write('other.txt', 'x\n'); t.commit('topic adds a file');
    t.git('checkout', '-q', 'main'); t.write('b.txt', 'y\n'); t.commit('main adds another');
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');

    await mergeTopic();
    assert.doesNotMatch(s.h.ui.pickOptions.placeHolder ?? '', /Conflicts expected/);
    assert.ok(s.h.ui.offered.some(o => /squash/i.test(o)), 'squash is offered when nothing clashes');
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.equal(s.h.t.git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'a merge commit');
  });
});

describe('a merge that stops on a conflict', () => {
  test('shows the banner with the number of files left, and a window naming them', async () => {
    await twoBranchesThatClash();
    await mergeTopic();
    assert.equal(s.page.$('#mergebar').hidden, false);
    assert.match(s.page.text('#mergebar'), /topic.*main.*1 conflict/i);
    assert.equal(s.page.$('#conflictdlg').hidden, false);
    assert.match(s.page.text('#conflictdlg'), /a\.txt/);
    assert.deepEqual(s.page.errors, []);
  });

  test('is resolved in the merge dialog by ticking a side, and the merge is finished with a commit', async () => {
    await twoBranchesThatClash();
    await mergeTopic();
    await openConflictedFile();
    assert.match(s.page.text('#diff'), /Merge conflict/);

    await s.click('#diff [data-file="merge"]');
    assert.equal(s.page.$('#mergedlg').hidden, false);
    assert.match(s.page.text('#mres'), /Merge Conflict/, 'the result still shows the conflict');
    await s.click('#mergedlg [data-ci="0"][data-side="theirs"]');
    assert.match(s.page.text('#mres'), /topic five/, 'the result takes the ticked side');
    assert.doesNotMatch(s.page.text('#mres'), /main five/);
    await s.click('#mergedlg [data-mact="resolve"]');

    assert.equal(s.page.$('#mergedlg').hidden, true);
    assert.equal(content(), 'topic five', 'the file holds the result');
    assert.match(s.page.text('#mergebar'), /commit|resolved/i, 'the banner says that all is solved');

    await s.type('#c-subject', 'Merge topic');
    await s.click('#c-commit');
    assert.equal(s.h.t.git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'a merge commit with two parents');
    assert.equal(s.page.$('#mergebar').hidden, true, 'the banner is gone');
  });

  test('both sides can be ticked: the result holds both', async () => {
    await twoBranchesThatClash();
    await mergeTopic();
    await openConflictedFile();
    await s.click('#diff [data-file="merge"]');
    await s.click('#mergedlg [data-ci="0"][data-side="theirs"]');
    await s.click('#mergedlg [data-ci="0"][data-side="ours"]');
    assert.match(s.page.text('#mres'), /topic five.*main five|main five.*topic five/);
  });

  test('is resolved with one side from the diff pane without the dialog', async () => {
    await twoBranchesThatClash();
    await mergeTopic();
    await openConflictedFile();
    await s.click('#diff [data-cside="ours"]'); // untick ours; theirs stays
    await s.click('#diff [data-file="resolveTheirs"]');
    assert.equal(content(), 'topic five');
    assert.deepEqual([...s.page.document.querySelectorAll('#staged li .fname')].map(e => e.textContent), ['a.txt']);
  });

  test('can be aborted, after a question, and the branch is as it was', async () => {
    await twoBranchesThatClash();
    await mergeTopic();
    const abort = [...s.page.document.querySelectorAll<HTMLButtonElement>('#mergebar button')].find(b => /abort/i.test(b.textContent ?? ''));
    assert.ok(abort);
    await s.click('#mergebar button:last-of-type');
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')), 'it asks first');
    assert.equal(content(), 'main five');
    assert.equal(s.page.$('#mergebar').hidden, true);
    assert.equal(s.h.t.git('status', '--porcelain'), '');
  });
});
