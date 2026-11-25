import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { Scenario } from './scenario';

// The windows Bonsai asks in: every kind of question, answered and cancelled as a user does it.

let s: Scenario;
afterEach(() => s?.dispose());

/** main with two commits, a branch "old" on the first and a stash "parked". */
async function repo() {
  s = new Scenario({ dialogs: true });
  const { t } = s.h;
  t.write('a.txt', 'a\n'); t.commit('base');
  t.git('branch', 'old');
  t.write('b.txt', 'b\n'); t.commit('second');
  t.write('a.txt', 'parked\n'); t.git('stash', 'push', '-q', '-m', 'parked');
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
}

const git = (...a: string[]) => s.h.t.git(...a).trim();
const dlg = () => s.page.$('#askdlg');
const title = () => s.page.text('#askdlg .mhead b');
const rowOf = (text: string) => `.row[data-i="${s.page.rows().findIndex(r => r.includes(text))}"]`;
const ok = () => s.click('#askdlg .primary');

describe('apply stash', () => {
  const stash = '#refs .ref[data-kind="stash"]';

  test('shows which stash; Cancel and Escape leave everything as it is', async () => {
    await repo();
    await s.rightClickAndChoose(stash, /^Apply/);
    assert.equal(title(), 'Apply Stash');
    assert.match(s.page.text('#askdlg .afacts'), /stash@\{0\} parked/);
    await s.click('#askdlg .mfoot [data-askact="close"]');
    assert.equal(dlg().hidden, true);

    await s.rightClickAndChoose(stash, /^Apply/);
    await s.key('#askdlg .aitem input', 'Escape');
    assert.equal(dlg().hidden, true);
    assert.equal(git('status', '--porcelain'), '');
  });

  test('applies, and the box decides whether the stash is deleted', async () => {
    await repo();
    await s.rightClickAndChoose(stash, /^Apply/);
    await s.click('#askdlg .aitem input');
    await ok();
    assert.equal(git('status', '--porcelain'), 'M a.txt');
    assert.equal(git('stash', 'list'), '', 'ticked: deleted');
  });
});

describe('a name', () => {
  test('is typed into the window and Enter takes it; an old one is there to be changed', async () => {
    await repo();
    await s.rightClickAndChoose('#refs .ref[data-name="old"]', /^Rename/);
    assert.equal(s.page.$<HTMLInputElement>('#ainput').value, 'old');
    await s.type('#ainput', 'older');
    await s.key('#ainput', 'Enter');
    assert.equal(dlg().hidden, true);
    assert.match(git('branch', '--list'), /older/);
  });
});

describe('a choice from a list, then a warning', () => {
  test('reset asks for the mode, and "hard" asks again before work is lost', async () => {
    await repo();
    s.h.t.write('a.txt', 'unsaved\n');
    await s.h.repo.status();
    await s.rightClickAndChoose(rowOf('base'), /^Reset/);
    assert.equal(s.page.document.querySelectorAll('#askdlg input[type="radio"]').length, 3);
    await s.click('#askdlg .aitem input[data-i="2"]');
    await ok();
    assert.match(title(), /1/, 'the second window says how much would be lost');
    await s.click('#askdlg .mfoot [data-askact="close"]');
    assert.equal(git('log', '-1', '--format=%s'), 'second', 'nothing happened');

    await s.rightClickAndChoose(rowOf('base'), /^Reset/);
    await s.click('#askdlg .aitem input[data-i="2"]');
    await ok();
    await ok();
    assert.equal(git('log', '-1', '--format=%s'), 'base');
  });
});

describe('the page is loaded anew while a window is open', () => {
  test('the question counts as cancelled and the next one works', async () => {
    await repo();
    await s.rightClickAndChoose('#refs .ref[data-name="old"]', /^Delete/);
    assert.equal(dlg().hidden, false);
    await s.reload();
    assert.equal(dlg().hidden, true);
    assert.match(git('branch', '--list'), /old/, 'nothing was deleted');
    await s.rightClickAndChoose('#refs .ref[data-name="old"]', /^Delete/);
    await ok();
    assert.doesNotMatch(git('branch', '--list'), /old/);
  });
});
