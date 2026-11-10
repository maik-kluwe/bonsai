import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createFetchDialog, defaultRemote }: { createFetchDialog(deps: any): any; defaultRemote(r: string[], d: any): string } = require('../../media/fetchdialog.js');
const { esc }: { esc(s: string): string } = require('../../media/diffhtml.js');

const data = {
  remotes: ['origin', 'fork'],
  currentBranch: 'main',
  refs: [{ kind: 'head', name: 'main', upstream: 'fork/main' }, { kind: 'head', name: 'lonely' }],
};

function setup(d: any = data) {
  const sent: any[] = [];
  const t = (k: string) => k;
  const dialog = createFetchDialog({ t, esc, post: (m: any) => sent.push(m) });
  dialog.open(d);
  return { dialog, sent };
}

describe('fetch dialog', () => {
  test('offers the remote of the current branch first, else the first one', () => {
    assert.equal(defaultRemote(data.remotes, data), 'fork');
    assert.equal(defaultRemote(data.remotes, { ...data, currentBranch: 'lonely' }), 'origin');
    assert.equal(defaultRemote([], data), '');
  });

  test('starts with "Fetch all remotes" ticked and the list of remotes off, as Fork does', () => {
    const html = setup().dialog.html();
    assert.match(html, /data-fetchopt="all" checked/);
    assert.match(html, /<select id="fremote" disabled>/);
    assert.match(html, /<option value="fork" selected>/);
  });

  test('all remotes: the message names none', () => {
    const { dialog, sent } = setup();
    assert.equal(dialog.fetch(), true);
    assert.deepEqual(sent, [{ type: 'fetch' }]);
    assert.equal(dialog.isOpen, false);
  });

  test('one remote: the message names it', () => {
    const { dialog, sent } = setup();
    dialog.setAll(false);
    dialog.setRemote('origin');
    assert.doesNotMatch(dialog.html(), /disabled>/);
    dialog.fetch();
    assert.deepEqual(sent, [{ type: 'fetch', remote: 'origin' }]);
  });

  test('without a remote there is nothing to fetch from', () => {
    const { dialog, sent } = setup({ refs: [], remotes: [] });
    assert.equal(dialog.canFetch, false);
    assert.match(dialog.html(), /data-fetchact="fetch" disabled/);
    assert.equal(dialog.fetch(), false);
    assert.deepEqual(sent, []);
  });

  test('a remote name cannot break the page', () => {
    const html = setup({ ...data, remotes: ['a"><script>'] }).dialog.html();
    assert.doesNotMatch(html, /<script>/);
  });
});
