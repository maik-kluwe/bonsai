import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { chmodSync, writeFileSync } from 'fs';
import * as path from 'path';
import { Scenario } from './scenario';

// README, "Stay in sync" (Push) and "See what happened" (Activity): the push dialog with its options, the server's message
// after a new branch, and the activity list that shows the Git commands.

let s: Scenario;
afterEach(() => s?.dispose());

async function withLocalCommit() {
  s = new Scenario().withServer();
  await s.open();
  s.h.t.write('n.txt', 'n\n');
  s.h.t.commit('local work');
  await s.click('#refresh');
}

const field = <T extends HTMLElement>(sel: string) => s.page.$<T>(`#pushdlg ${sel}`);

describe('the push dialog', () => {
  test('offers the current branch and its upstream, and sends the commits on Push', async () => {
    await withLocalCommit();
    assert.equal(s.page.text('#ahead'), '1');
    await s.click('[data-action="push"]');
    assert.equal(s.page.$('#pushdlg').hidden, false);
    assert.equal(field<HTMLSelectElement>('#pbranch').value, 'main');
    assert.match(s.page.text('#pushdlg #ptarget'), /origin\/main/);

    await s.click('#pushdlg [data-pact="push"]');
    assert.deepEqual(s.page.sentOf('push'), [{ type: 'push', branch: 'main', remote: 'origin', remoteBranch: 'main', track: false, tags: false, force: false }], 'the current branch with its upstream, as it is');
    assert.equal(s.page.$('#pushdlg').hidden, true);
    assert.equal(s.server('log', '-1', '--format=%s', 'main'), 'local work', 'the server has the commit');
    assert.equal(s.page.text('#ahead'), '', 'nothing is ahead any more');
  });

  test('pushes all tags when asked to', async () => {
    await withLocalCommit();
    s.h.t.git('tag', 'v1.0');
    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-popt="tags"]');
    await s.click('#pushdlg [data-pact="push"]');
    assert.match(s.server('tag', '--list'), /v1\.0/);
  });

  test('refuses a push that would overwrite the server unless force is ticked, and then uses force with lease', async () => {
    await withLocalCommit();
    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-pact="push"]');
    s.h.t.git('commit', '-q', '--amend', '-m', 'local work, reworded');
    await s.click('#refresh');

    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-pact="push"]');
    assert.equal(s.h.ui.errors.length, 1, 'the server rejects the rewritten history');
    assert.equal(s.server('log', '-1', '--format=%s', 'main'), 'local work', 'and keeps its own');

    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-popt="force"]');
    await s.click('#pushdlg [data-pact="push"]');
    assert.equal(s.server('log', '-1', '--format=%s', 'main'), 'local work, reworded');
  });

  test('can create a branch on the server, track it, and shows what the server printed with its link', async () => {
    s = new Scenario().withServer();
    await s.open();
    const hook = path.join(s.serverDir, 'hooks', 'post-receive');
    writeFileSync(hook, '#!/bin/sh\necho "Create a merge request: https://git.example/mr/new" >&2\n');
    chmodSync(hook, 0o755);
    s.h.t.git('checkout', '-q', '-b', 'feature');
    s.h.t.write('f.txt', 'f\n');
    s.h.t.commit('feature work');
    await s.h.repo.status();
    await s.click('#refresh');

    await s.click('[data-action="push"]');
    assert.equal(field<HTMLSelectElement>('#pbranch').value, 'feature');
    const track = s.page.document.querySelector<HTMLInputElement>('#pushdlg [data-popt="track"]');
    assert.ok(track?.checked, 'a new branch can be tracked, and the box starts ticked');
    await s.click('#pushdlg [data-pact="push"]');

    assert.match(s.server('branch', '--list'), /feature/);
    assert.equal(s.h.t.git('rev-parse', '--abbrev-ref', 'feature@{upstream}').trim(), 'origin/feature', 'it tracks the new branch');
    assert.equal(s.page.$('#pushdlg').hidden, false, 'the server had something to say');
    assert.match(s.page.text('#pushdlg'), /Create a merge request/);

    await s.click('#pushdlg [data-url]');
    const opened = s.windowMessages.find(m => m.type === 'openUrl');
    assert.ok(opened && 'url' in opened && opened.url === 'https://git.example/mr/new', 'the link goes to the browser');
  });
});

describe('the activity list', () => {
  test('shows what Bonsai did with the Git commands and what they printed', async () => {
    await withLocalCommit();
    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-pact="push"]');
    await s.click('#activity');

    assert.equal(s.page.$('#activity-pop').hidden, false);
    const text = s.page.text('#activity-pop');
    assert.match(text, /Push/, 'the action');
    assert.match(text, /git push/, 'the command that ran');
  });

  test('shows a step that failed, with the reason', async () => {
    await withLocalCommit();
    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-pact="push"]');
    s.h.t.git('commit', '-q', '--amend', '-m', 'reworded');
    await s.click('[data-action="push"]');
    await s.click('#pushdlg [data-pact="push"]');
    await s.click('#activity');
    assert.match(s.page.text('#activity-pop'), /rejected|failed|non-fast-forward/i);
  });

  test('stays empty while nothing has been done', async () => {
    s = new Scenario().withServer();
    await s.open();
    await s.click('#activity');
    assert.equal(s.page.document.querySelectorAll('#activity-pop .aentry, #activity-pop li').length, 0);
  });
});
