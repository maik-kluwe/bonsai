import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { Scenario } from './scenario';

// README, "Stay in sync": Fetch, Pull and the conflict window, from the click to what the view shows afterwards.
// Real view, real handlers, real Git repositories (a server and a colleague who pushes); see scenario.ts for what is left out.

let s: Scenario;
const start = async () => { s = new Scenario().withServer(); await s.open(); return s; };
afterEach(() => s?.dispose());

const box = (name: string) => s.page.$<HTMLInputElement>(`#pulldlg [data-pullopt="${name}"]`);
const file = (name: string) => readFileSync(path.join(s.h.t.dir, name), 'utf8').split('\n');
const pull = async () => { await s.click('[data-action="pull"]'); };

describe('Fetch', () => {
  test('starts with all remotes, and shows how far behind the branch is once the colleague has pushed', async () => {
    await start();
    assert.equal(s.page.text('#behind'), '', 'in sync: no badge');
    s.colleaguePushes('a.txt', 3, 'from the colleague');

    await s.click('[data-action="fetch"]');
    assert.equal(s.page.$('#fetchdlg').hidden, false, 'asks from which remote');
    assert.equal(s.page.$<HTMLInputElement>('#fetchdlg [data-fetchopt="all"]').checked, true, 'all remotes is ticked, as in Fork');
    assert.equal(s.page.$<HTMLSelectElement>('#fremote').disabled, true, 'and the list of remotes is off');
    await s.click('#fetchdlg [data-fetchact="fetch"]');

    assert.deepEqual(s.page.sentOf('fetch'), [{ type: 'fetch' }], 'the message names no remote');
    assert.equal(s.page.$('#fetchdlg').hidden, true);
    assert.equal(s.page.text('#behind'), '1');
  });

  test('can name one remote', async () => {
    await start();
    await s.click('[data-action="fetch"]');
    await s.click('#fetchdlg [data-fetchopt="all"]');
    assert.equal(s.page.$<HTMLSelectElement>('#fremote').disabled, false, 'the list of remotes is on');
    await s.click('#fetchdlg [data-fetchact="fetch"]');
    assert.deepEqual(s.page.sentOf('fetch'), [{ type: 'fetch', remote: 'origin' }]);
  });

  test('has nothing to do in a repository without a remote', async () => {
    s = new Scenario();
    await s.open();
    await s.click('[data-action="fetch"]');
    assert.equal(s.page.$('#fetchdlg').hidden, false);
    assert.equal(s.page.$<HTMLButtonElement>('#fetchdlg [data-fetchact="fetch"]').disabled, true);
    await s.click('#fetchdlg [data-fetchact="fetch"]');
    assert.deepEqual(s.page.sentOf('fetch'), []);
    assert.equal(s.page.$('#fetchdlg').hidden, false, 'the dialog stays');
  });
});

describe('Pull', () => {
  test('says where from, where to and how many commits are new', async () => {
    await start();
    s.colleaguePushes('a.txt', 3, 'one');
    await pull();
    assert.match(s.page.text('#pulldlg'), /origin\/main/);
    assert.match(s.page.text('#pulldlg'), /Into\s*main/, 'and into which branch');
    assert.equal(s.page.$('#pulldlg .phint').hidden, true, 'nothing blocks, so there is no hint');
    assert.equal(box('rebase').checked || box('stash').checked, false, 'nothing is ticked before anything was chosen');
    assert.match(s.page.text('#pulldlg'), /1 new commit(?!s)/, 'one is not "1 new commits"');
    await s.click('#pulldlg [data-pullact="close"]');

    s.colleaguePushes('a.txt', 4, 'two');
    await pull();
    assert.match(s.page.text('#pulldlg'), /2 new commits/);
  });

  test('a blocked merge is explained, and with stash ticked the local change comes back next to the new commit', async () => {
    await start();
    s.colleaguePushes('a.txt', 3, 'from the colleague');
    s.editLocally('a.txt', 20, 'my change');

    await pull();
    assert.equal(s.page.$('#pulldlg').hidden, false);
    assert.match(s.page.text('#pulldlg .phint'), /a\.txt/, 'says which file blocks the merge');
    assert.equal(box('stash').checked, false, 'it does not tick the box itself');

    box('stash').click();
    assert.match(s.page.text('#pulldlg .phint'), /./, 'the hint says what happens to the local change');
    await s.click('#pulldlg [data-pullact="pull"]');

    assert.deepEqual(s.page.sentOf('pull'), [{ type: 'pull', rebase: false, stash: true }], 'the boxes as ticked');
    assert.equal(s.page.$('#pulldlg').hidden, true);
    assert.equal(file('a.txt')[2], 'from the colleague', 'the new commit is in');
    assert.equal(file('a.txt')[19], 'my change', 'the local change is back');
    assert.equal(s.page.text('#behind'), '', 'up to date again');
    assert.equal(s.page.text('#changes-count'), '1', 'the local change is still pending');
    assert.deepEqual(s.h.ui.errors, []);
    assert.deepEqual(s.page.errors, []);
  });

  test('a local change that clashes with the new commit opens the conflict window and the banner', async () => {
    await start();
    s.colleaguePushes('a.txt', 3, 'from the colleague');
    s.editLocally('a.txt', 3, 'from me');

    await pull();
    assert.match(s.page.text('#pulldlg .phint'), /a\.txt/);
    box('stash').click();
    await s.click('#pulldlg [data-pullact="pull"]');

    assert.equal(s.page.$('#conflictdlg').hidden, false);
    assert.match(s.page.text('#conflictdlg'), /1 file has conflicts\./, 'one file is said in the singular');
    assert.match(s.page.text('#conflictdlg'), /a\.txt/);
    const printed = s.page.$<HTMLDetailsElement>('#conflictdlg details.cout');
    assert.equal(printed.open, false, 'what Git printed is behind a fold');
    assert.match(printed.textContent ?? "", /resulted in conflicts/);
    assert.equal(s.page.$('#mergebar').hidden, false, 'the banner takes over');
  });

  test('without the stash box Git refuses a pull that is in the way, and the user hears why', async () => {
    await start();
    s.colleaguePushes('a.txt', 20, 'from the colleague');
    s.editLocally('a.txt', 1, 'my change');
    await pull();
    await s.click('#pulldlg [data-pullact="pull"]');
    assert.equal(s.h.ui.errors.length, 1);
    assert.match(s.h.ui.errors[0], /overwritten/, 'the reason Git gave, not "Failed to execute git"');
    assert.equal(file('a.txt')[19], '20', 'nothing was pulled');
    assert.equal(file('a.txt')[0], 'my change', 'and the change is where it was');
  });

  test('a dialog that was cancelled keeps nothing for the next time', async () => {
    await start();
    s.colleaguePushes('b.txt', 5, 'one');
    await pull();
    box('rebase').click();
    await s.click('#pulldlg [data-pullact="close"]');
    assert.equal(s.page.$('#pulldlg').hidden, true);
    assert.deepEqual(s.page.sentOf('pull'), [], 'nothing was sent');
    await pull();
    assert.equal(box('rebase').checked, false, 'the box did not stay ticked');
  });

  test('without an earlier choice the rebase box follows the Git settings and the stash box is off', async () => {
    await start();
    s.h.t.git('config', 'pull.rebase', 'true');
    s.colleaguePushes('b.txt', 5, 'from the colleague');
    await pull();
    assert.equal(box('rebase').checked, true);
    assert.equal(box('stash').checked, false);
  });

  test('starts with the boxes as the user left them the last time, whatever the settings say', async () => {
    await start();
    s.colleaguePushes('b.txt', 5, 'one');
    await pull();
    box('rebase').click();
    box('stash').click();
    await s.click('#pulldlg [data-pullact="pull"]');
    assert.deepEqual(s.page.sentOf('pull').at(-1), { type: 'pull', rebase: true, stash: true });

    s.colleaguePushes('b.txt', 6, 'two');
    await pull();
    assert.equal(box('rebase').checked, true, 'ticked last time');
    assert.equal(box('stash').checked, true);
    box('rebase').click();
    box('stash').click();
    await s.click('#pulldlg [data-pullact="pull"]');

    s.h.t.git('config', 'pull.rebase', 'true');
    s.colleaguePushes('b.txt', 7, 'three');
    await pull();
    assert.equal(box('rebase').checked, false, 'unticked last time, although the setting says rebase');
    assert.equal(box('stash').checked, false);
  });
});
