import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
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

describe('a double click on a button that closes its window', () => {
  /** The events of a double click whose second click finds something else under the pointer: the window is gone by then. */
  async function doubleClick(first: string, second: string) {
    const press = async (selector: string, detail: number, types: string[]) => {
      const el = s.page.$(selector);
      for (const type of types) el.dispatchEvent(new s.page.dom.window.MouseEvent(type, { bubbles: true, detail }));
      await s.settle();
    };
    await press(first, 1, ['mousedown', 'mouseup', 'click']);
    await press(second, 2, ['mousedown', 'mouseup', 'click', 'dblclick']);
  }

  test('does not reach what lay under it; a double click on the row itself still checks out', async () => {
    await repo();
    const cancel = '#askdlg .mfoot [data-askact="close"]';
    for (const under of [rowOf('base'), '#refs .ref[data-name="old"]']) {
      await s.click('[data-action="branch"]');
      await doubleClick(cancel, under);
      assert.equal(dlg().hidden, true);
      assert.equal(git('branch', '--show-current'), 'main', under);
    }
    await doubleClick(rowOf('base'), rowOf('base'));
    assert.equal(git('branch', '--show-current'), 'old');
  });

  test('nor does one on a menu entry stage the file under it', async () => {
    await repo();
    s.h.t.write('new.txt', 'new\n');
    await s.h.repo.status();
    await s.click('#refresh');
    await s.click('.nav-item[data-view="changes"]');
    const file = '#unstaged .file';
    s.page.$(rowOf('base')).dispatchEvent(new s.page.dom.window.MouseEvent('contextmenu', { bubbles: true }));
    const copy = [...s.page.document.querySelectorAll<HTMLElement>('#menu .mi')].find(e => /copy/i.test(e.textContent!))!;
    await doubleClick(`#menu .mi[data-i="${copy.dataset.i}"]`, file);
    assert.equal(git('status', '--porcelain'), '?? new.txt');
    await doubleClick(file, file);
    assert.equal(git('status', '--porcelain'), 'A  new.txt');
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

describe('checking out with local changes', () => {
  /** main and "same" (a.txt as on main) and "differs" (a.txt changed in its first line); a.txt has a local change in line 5. */
  async function branches() {
    s = new Scenario();
    const { t } = s.h;
    t.write('a.txt', 'one\ntwo\nthree\nfour\nfive\n'); t.write('b.txt', 'b\n'); t.commit('base');
    t.git('branch', 'same');
    t.git('checkout', '-q', '-b', 'differs'); t.write('a.txt', 'ONE\ntwo\nthree\nfour\nfive\n'); t.write('c.txt', 'theirs\n'); t.commit('differs');
    t.git('checkout', '-q', 'main');
    t.write('a.txt', 'one\ntwo\nthree\nfour\nlocal\n');
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');
  }
  const read = (file: string) => readFileSync(path.join(s.h.t.dir, file), 'utf8').replaceAll('\r', '');
  const branch = () => git('branch', '--show-current');
  const switchTo = async (name: string) => {
    s.page.$(`#refs .ref[data-name="${name}"]`).dispatchEvent(new s.page.dom.window.MouseEvent('dblclick', { bubbles: true }));
    await s.settle();
  };
  const choose = (mode: string) => { const radio = s.page.$<HTMLInputElement>(`#codlg [data-comode="${mode}"]`); radio.click(); };
  const hint = () => s.page.text('#codlg .phint');
  const go = () => s.click('#codlg [data-coact="checkout"]');

  test('asks first; "Don\'t change" takes the changes along, or lets Git refuse', async () => {
    await branches();
    await switchTo('same');
    assert.equal(s.page.$('#codlg').hidden, false);
    assert.equal(branch(), 'main', 'nothing happens before the answer');
    assert.match(hint(), /come along/);
    await go();
    assert.equal(branch(), 'same');
    assert.match(read('a.txt'), /local/);

    await switchTo('differs');
    assert.match(hint(), /a\.txt would be overwritten/);
    await go();
    assert.equal(branch(), 'same');
    assert.match(s.h.ui.errors.join(), /overwritten/);
  });

  test('"Stash and reapply" switches, keeps what is staged and drops its stash; it is offered again next time', async () => {
    await branches();
    s.h.t.write('b.txt', 'staged\n'); s.h.t.git('add', 'b.txt');
    await switchTo('differs');
    choose('stash');
    assert.match(hint(), /cleanly/);
    await go();
    assert.equal(branch(), 'differs');
    assert.equal(read('a.txt'), 'ONE\ntwo\nthree\nfour\nlocal\n');
    assert.match(git('diff', '--cached', '--name-only'), /b\.txt/);
    assert.equal(git('stash', 'list'), '');

    await switchTo('same');
    assert.equal(s.page.$<HTMLInputElement>('#codlg [data-comode="stash"]').checked, true);
  });

  test('when reapplying conflicts, the branch is switched, the conflict is shown and the stash is kept', async () => {
    await branches();
    s.h.t.write('a.txt', 'mine\ntwo\nthree\nfour\nfive\n');
    await switchTo('differs');
    choose('stash');
    assert.match(hint(), /conflict in a\.txt/);
    await go();
    assert.equal(branch(), 'differs');
    assert.match(read('a.txt'), /<<<<<<</);
    assert.match(git('stash', 'list'), /Autostash before checkout of differs/);
    assert.equal(s.page.$('#conflictdlg').hidden, false);
  });

  test('a staged change that does not apply on the other branch comes back as a conflict, and the stash is kept', async () => {
    await branches();
    s.h.t.write('a.txt', 'staged\ntwo\nthree\nfour\nfive\n'); s.h.t.git('add', 'a.txt');
    await switchTo('differs');
    choose('stash');
    await go();
    assert.equal(branch(), 'differs');
    assert.match(read('a.txt'), /<<<<<<</);
    assert.match(git('stash', 'list'), /Autostash/);
  });

  test('"Discard" works for a branch only the server has; closing the dialog leaves no entry in the activity log', async () => {
    await branches();
    s.h.t.git('update-ref', 'refs/remotes/origin/elsewhere', 'differs');
    s.h.t.git('remote', 'add', 'origin', 'nowhere');
    await switchTo('same');
    await s.click('#codlg .mfoot [data-coact="close"]');
    await s.click('#activity');
    assert.doesNotMatch(s.page.text('#activity-pop'), /Checkout/);

    await s.click('#refresh');
    s.page.send({ type: 'checkoutInfo', info: { ref: 'elsewhere', changes: 1, overwritten: [], stash: false } });
    choose('discard');
    await go();
    assert.equal(branch(), 'elsewhere');
    assert.equal(git('rev-parse', '--abbrev-ref', 'elsewhere@{upstream}'), 'origin/elsewhere');
    assert.equal(git('status', '--porcelain'), '');
  });

  test('when the checkout fails after stashing, the changes are put back', async () => {
    await branches();
    s.h.t.write('c.txt', 'untracked\n');
    await switchTo('differs');
    choose('stash');
    await go();
    assert.equal(branch(), 'main');
    assert.match(read('a.txt'), /local/);
    assert.equal(git('stash', 'list'), '');
  });

  test('"Discard" warns, throws the changes away and is not chosen the next time; an untracked file in the way stops it', async () => {
    await branches();
    s.h.t.write('c.txt', 'untracked\n');
    await switchTo('differs');
    choose('discard');
    assert.match(hint(), /lost for good/);
    await go();
    assert.equal(branch(), 'main');
    assert.match(read('a.txt'), /local/, 'nothing was discarded');
    assert.equal(read('c.txt'), 'untracked\n');
    assert.match(s.h.ui.errors.join(), /c\.txt/);

    s.h.t.git('clean', '-fq');
    await switchTo('differs');
    assert.equal(s.page.$<HTMLInputElement>('#codlg [data-comode="discard"]').checked, false);
    choose('discard');
    await go();
    assert.equal(branch(), 'differs');
    assert.equal(git('status', '--porcelain'), '');
  });

  test('without local changes there is no question, and Cancel leaves everything', async () => {
    await branches();
    await switchTo('same');
    await s.click('#codlg .mfoot [data-coact="close"]');
    assert.equal(branch(), 'main');
    s.h.t.git('checkout', '-q', '--', 'a.txt');
    await s.h.repo.status();
    await switchTo('same');
    assert.equal(s.page.$('#codlg').hidden, true);
    assert.equal(branch(), 'same');
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
