import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { Scenario } from './scenario';
import { lines } from './helpers';

// README, "Stage exactly what you want": the lists of Local Changes, staging a file, a hunk or single lines, discarding, committing, amending.

let s: Scenario;
afterEach(() => s?.dispose());

/** a.txt with two changes far apart (two hunks, the first one with two changed lines) and b.txt, committed. */
async function localChanges() {
  s = new Scenario();
  const { t } = s.h;
  t.write('a.txt', lines(30)); t.write('b.txt', 'b\n'); t.commit('base');
  const a = lines(30).split('\n');
  a[2] = 'changed three'; a[3] = 'changed four'; a[25] = 'changed twentysix';
  t.write('a.txt', a.join('\n'));
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
  await s.click('.nav-item[data-view="changes"]');
}

const names = (list: 'unstaged' | 'staged') => [...s.page.document.querySelectorAll(`#${list} li .fname`)].map(e => e.textContent);
const cached = () => s.h.t.git('diff', '--cached', '--', 'a.txt');
const worktree = () => s.h.t.git('diff', '--', 'a.txt');
const hunkButton = (i: number, what: 'stage' | 'discard') => `#diff .hunk[data-i="${i}"] [data-hunk="${what}"]`;

describe('the lists', () => {
  test('show what is staged, what is not and what is new, and the count on the tab', async () => {
    await localChanges();
    s.h.t.write('new.txt', 'n\n'); s.h.t.write('b.txt', 'b2\n'); s.h.t.git('add', 'b.txt');
    await s.click('#refresh');
    assert.deepEqual(names('unstaged'), ['a.txt', 'new.txt']);
    assert.deepEqual(names('staged'), ['b.txt']);
    assert.equal(s.page.text('#changes-count'), '3');
    assert.match(s.page.text('#unstaged li:last-child .st'), /U/, 'the new file is marked untracked');
  });
});

describe('a whole file', () => {
  test('is staged with the button or a double click and unstaged the same way', async () => {
    await localChanges();
    await s.click('#unstaged li');
    await s.click('#unstaged [data-bulk="stage"]');
    assert.deepEqual(names('staged'), ['a.txt']);
    assert.deepEqual(names('unstaged'), []);

    await s.click('#staged li', { detail: 2 });
    assert.deepEqual(names('unstaged'), ['a.txt'], 'a double click moves it back');
    assert.equal(cached(), '');
  });

  test('is discarded from the context menu after a question', async () => {
    await localChanges();
    await s.rightClick('#unstaged li');
    const entry = [...s.page.document.querySelectorAll<HTMLElement>('#menu .mi')].find(e => /^Discard changes/.test(e.textContent ?? ''));
    assert.ok(entry, `a Discard entry in the menu: ${s.page.text('#menu')}`);
    await s.click(`#menu .mi[data-i="${entry.dataset.i}"]`);
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')), 'it asks first');
    assert.equal(s.h.t.git('status', '--porcelain'), '', 'and the change is gone');
    assert.deepEqual(names('unstaged'), []);
  });
});

describe('a hunk', () => {
  test('is staged on its own, and the other stays', async () => {
    await localChanges();
    await s.click('#unstaged li');
    await s.click(hunkButton(0, 'stage'));
    assert.match(cached(), /\+changed three/);
    assert.doesNotMatch(cached(), /changed twentysix/, 'the second hunk is not staged');
    assert.match(worktree(), /\+changed twentysix/, 'it is still a local change');
    assert.deepEqual(names('staged'), ['a.txt']);
    assert.deepEqual(names('unstaged'), ['a.txt'], 'the file is in both lists');
  });

  test('is discarded on its own after a question', async () => {
    await localChanges();
    await s.click('#unstaged li');
    await s.click(hunkButton(1, 'discard'));
    assert.ok(s.h.ui.asked.some(q => q.startsWith('confirm')));
    assert.doesNotMatch(worktree(), /changed twentysix/);
    assert.match(worktree(), /\+changed three/, 'the first hunk is untouched');
  });
});

describe('single lines', () => {
  test('only the lines you select are staged', async () => {
    await localChanges();
    await s.click('#unstaged li');
    const added = [...s.page.document.querySelectorAll<HTMLElement>('#diff .hunk[data-i="0"] tr.pick')].find(r => /changed three/.test(r.textContent ?? ''));
    assert.ok(added, 'the added line can be picked');
    await s.click(`#diff .hunk[data-i="0"] tr.pick[data-l="${added.dataset.l}"]`);
    await s.click('#diff .hunk[data-i="0"] [data-lines="stage"]');
    assert.match(cached(), /\+changed three/);
    assert.doesNotMatch(cached(), /changed four/, 'the neighbour is not staged');
    assert.match(worktree(), /\+changed four/);
  });
});

describe('committing', () => {
  test('commits what is staged with the message, and the box is empty again', async () => {
    await localChanges();
    await s.click('#unstaged li');
    await s.click('#unstaged [data-bulk="stage"]');
    await s.type('#c-subject', 'Change a.txt');
    await s.type('#c-body', 'Two spots.');
    await s.click('#c-commit');
    assert.equal(s.h.t.git('log', '-1', '--format=%s').trim(), 'Change a.txt');
    assert.match(s.h.t.git('log', '-1', '--format=%b'), /Two spots\./);
    assert.deepEqual(names('staged'), []);
    assert.equal(s.page.$<HTMLInputElement>('#c-subject').value, '', 'the message is cleared');
  });

  test('Amend puts the last message into the box and rewrites the last commit instead of adding one', async () => {
    await localChanges();
    const before = s.h.t.git('rev-list', '--count', 'HEAD').trim();
    await s.click('#unstaged li');
    await s.click('#unstaged [data-bulk="stage"]');
    s.page.$<HTMLInputElement>('#c-amend').click();
    await s.settle();
    assert.equal(s.page.$<HTMLInputElement>('#c-subject').value, 'base', 'the message of the last commit');
    await s.type('#c-subject', 'base, amended');
    await s.click('#c-commit');
    assert.equal(s.h.t.git('rev-list', '--count', 'HEAD').trim(), before, 'no new commit');
    assert.equal(s.h.t.git('log', '-1', '--format=%s').trim(), 'base, amended');
    assert.match(s.h.t.git('show', '--stat', '--format=', 'HEAD'), /a\.txt/, 'and the staged change went into it');
  });
});
