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

  test('a remote name cannot break the page', () => {
    const html = setup({ ...data, remotes: ['a"><script>'] }).dialog.html();
    assert.doesNotMatch(html, /<script>/);
  });
});
