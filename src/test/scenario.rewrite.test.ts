import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { existsSync } from 'fs';
import * as path from 'path';
import { Scenario } from './scenario';

// README, "Rewrite history": cherry-pick, revert, reset and rebase from the menus, dragging a branch, stashes.
// (The interactive rebase has a window of its own: scenario.rebasedialog.test.ts.)

let s: Scenario;
afterEach(() => s?.dispose());

/** base, then main with "main work" (m.txt) and topic with "topic work" (t.txt); main is checked out. */
async function diverged() {
  s = new Scenario();
  const { t } = s.h;
  t.write('a.txt', 'a\n'); t.commit('base');
  t.git('checkout', '-q', '-b', 'topic'); t.write('t.txt', 't\n'); t.commit('topic work');
  t.git('checkout', '-q', 'main'); t.write('m.txt', 'm\n'); t.commit('main work');
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
}

const rowOf = (text: string) => `.row[data-i="${s.page.rows().findIndex(r => r.includes(text))}"]`;
const subjects = (...range: string[]) => s.h.t.git('log', '--format=%s', ...range).trim().split('\n');
const has = (file: string) => existsSync(path.join(s.h.t.dir, file));

describe('a commit', () => {
  test('is cherry-picked onto the current branch from its menu', async () => {
    await diverged();
    await s.rightClickAndChoose(rowOf('topic work'), /^Cherry-pick/);
    assert.deepEqual(subjects('-2'), ['topic work', 'main work']);
    assert.ok(has('t.txt'));
    assert.deepEqual(s.h.ui.errors, []);
  });

  test('is reverted by a new commit', async () => {
    await diverged();
    await s.rightClickAndChoose(rowOf('main work'), /^Revert commit/);
    assert.match(subjects('-1')[0], /^Revert "main work"/);
    assert.equal(has('m.txt'), false, 'the change is undone');
    assert.deepEqual(subjects('-3').length, 3, 'and the old commit is still there');
  });

  test('is the new tip of the branch after a reset, with the choice of how hard', async () => {
    await diverged();
    s.h.t.write('m2.txt', 'm2\n'); s.h.t.commit('later work');
    await s.click('#refresh');
    s.h.ui.pickAnswer = items => items.find(i => /hard/i.test(i.label));
    await s.rightClickAndChoose(rowOf('main work'), /^Reset/);
    assert.ok(s.h.ui.offered.some(b => /soft/i.test(b)) && s.h.ui.offered.some(b => /hard/i.test(b)), `the choices: ${s.h.ui.offered}`);
    assert.equal(subjects('-1')[0], 'main work');
    assert.equal(has('m2.txt'), false, 'hard: the later change is gone from the files, too');
  });
});

describe('a branch', () => {
  test('is rebased onto another from its menu', async () => {
    await diverged();
    await s.rightClickAndChoose('#refs .ref[data-name="topic"]', /^Rebase 'main' onto 'topic'/);
    assert.deepEqual(subjects('-3'), ['main work', 'topic work', 'base'], 'main now sits on top of topic, in a line');
    assert.equal(s.h.t.git('rev-list', '--merges', '--count', 'HEAD').trim(), '0');
  });

  test('is merged or rebased by dragging it onto the current branch', async () => {
    await diverged();
    await s.drag('#refs .ref[data-name="topic"]', rowOf('main work') + ' .badge-ref[data-name="main"]');
    const entries = s.menuEntries();
    assert.ok(entries.some(e => /^Merge/.test(e)) && entries.some(e => /^Rebase/.test(e)), `the drop offers: ${entries.join(' | ')}`);
    await s.menu(/^Merge/);
    assert.equal(s.h.t.git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'a merge commit');
  });

  test('has no drop target where nothing can happen', async () => {
    await diverged();
    await s.drag('#refs .ref[data-name="topic"]', rowOf('base'));
    assert.deepEqual(s.menuEntries(), [], 'neither branch is the current one');
  });
});

describe('the interactive rebase', () => {
  test('is asked for from the menu of a commit and opens in its own window', async () => {
    await diverged();
    s.h.t.write('m2.txt', 'm2\n'); s.h.t.commit('later work');
    await s.click('#refresh');
    await s.rightClickAndChoose(rowOf('main work'), /^Interactive rebase from here/);
    const asked = s.windowMessages.find(m => m.type === 'interactiveRebase');
    assert.ok(asked && 'hash' in asked && asked.hash === s.h.t.git('rev-parse', 'HEAD~1').trim(), 'the window is asked to open for that commit');
  });
});

describe('stashes', () => {
  test('are saved from the toolbar with a message, and the files are clean again', async () => {
    await diverged();
    s.h.t.write('a.txt', 'dirty\n');
    await s.click('#refresh');
    s.h.ui.inputAnswer = 'parked work';
    await s.click('[data-action="stash"]');
    assert.match(s.h.t.git('stash', 'list'), /parked work/);
    assert.equal(s.h.t.git('status', '--porcelain'), '');
    assert.match(s.page.text('#refs'), /parked work/, 'and it is in the sidebar');
  });

  test('are saved for a few files only: select in Local Changes, right-click, tick and name', async () => {
    await diverged();
    s.h.t.write('a.txt', 'dirty a\n'); s.h.t.write('m.txt', 'dirty m\n'); s.h.t.write('new.txt', 'n\n');
    await s.click('#refresh');
    await s.click('.nav-item[data-view="changes"]');
    const rowOfFile = (name: string) => [...s.page.document.querySelectorAll<HTMLElement>('#unstaged li')].find(li => li.title === name)!;
    await s.click(`#unstaged li[data-i="${rowOfFile('m.txt').dataset.i}"]`);
    await s.rightClickAndChoose(`#unstaged li[data-i="${rowOfFile('m.txt').dataset.i}"]`, /^Stash 1 File/);

    assert.equal(s.page.$('#stashdlg').hidden, false);
    const shown = [...s.page.document.querySelectorAll<HTMLInputElement>('#stashdlg .scb')].map(c => [c.dataset.path, c.checked]);
    assert.deepEqual(shown, [['a.txt', false], ['m.txt', true], ['new.txt', false]], 'every changed file once, sorted, the selected one ticked');

    await s.click('#stashdlg .scb[data-path="a.txt"]'); // and a second one
    await s.type('#smsg', '  only m and a  ');
    await s.click('#stashdlg [data-sact="save"]');
    assert.equal(s.page.$('#stashdlg').hidden, true);
    assert.match(s.h.t.git('stash', 'list', '--format=%s').trim(), /^On main: only m and a$/, 'the message is trimmed');
    assert.equal(s.h.t.git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map(l => l.slice(3)).sort().join(','), 'new.txt', 'both ticked files were put away, the new one was not');
  });

  test('are not saved when no file is ticked, and the dialog stays', async () => {
    await diverged();
    s.h.t.write('m.txt', 'dirty m\n');
    await s.click('#refresh');
    await s.click('.nav-item[data-view="changes"]');
    await s.click('#unstaged li');
    await s.rightClickAndChoose('#unstaged li', /^Stash 1 File/);
    await s.click('#stashdlg .scb');
    assert.equal(s.page.$<HTMLButtonElement>('#ssave').disabled, true, 'nothing to save');
    await s.click('#stashdlg [data-sact="save"]');
    assert.equal(s.page.$('#stashdlg').hidden, false);
    assert.equal(s.h.t.git('stash', 'list').trim(), '');
  });

  test('are applied, renamed and deleted from the menu of the stash', async () => {
    await diverged();
    s.h.t.write('a.txt', 'dirty\n'); s.h.t.git('stash', 'push', '-q', '-m', 'parked');
    await s.click('#refresh');
    const stash = '#refs .ref[data-kind="stash"]';

    await s.rightClickAndChoose(stash, /^Apply/);
    assert.equal(s.h.t.git('status', '--porcelain').trim(), 'M a.txt', 'the changes are back');
    assert.match(s.h.t.git('stash', 'list'), /parked/, 'and the stash is kept');

    s.h.ui.inputAnswer = 'renamed';
    await s.rightClickAndChoose(stash, /^Rename/);
    assert.match(s.h.t.git('stash', 'list'), /renamed/);

    await s.rightClickAndChoose(stash, /^Delete/);
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')), 'it asks first');
    assert.equal(s.h.t.git('stash', 'list').trim(), '');
    assert.doesNotMatch(s.page.text('#refs'), /renamed/);
  });

  test('can be looked into before applying', async () => {
    await diverged();
    s.h.t.write('a.txt', 'dirty\n'); s.h.t.write('new.txt', 'n\n'); s.h.t.git('add', 'new.txt'); s.h.t.git('stash', 'push', '-q', '-m', 'parked');
    await s.click('#refresh');
    await s.click('#refs .ref[data-kind="stash"]');
    assert.match(s.page.text('#details'), /a\.txt/);
    assert.match(s.page.text('#details'), /new\.txt/);
    assert.equal(s.h.t.git('status', '--porcelain'), '', 'nothing was applied');
  });
});
