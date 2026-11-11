import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createStashDialog }: { createStashDialog(deps: any): any } = require('../../media/stashdialog.js');
const { esc }: { esc(s: string): string } = require('../../media/diffhtml.js');

const lists = {
  staged: [{ path: 'b.txt' }, { path: 'new.txt', oldPath: 'old.txt' }],
  unstaged: [{ path: 'a<1>.txt' }, { path: 'b.txt' }, { path: 'c.txt' }],
};

function setup(paths = ['b.txt']) {
  const sent: any[] = [];
  const dialog = createStashDialog({ t: (k: string) => k, esc, post: (m: any) => sent.push(m) });
  dialog.open(paths, lists);
  return { dialog, sent };
}
const shown = (html: string) => [...html.matchAll(/data-path="([^"]*)"( checked)?/g)].map(m => [m[1], !!m[2]]);

describe('stash dialog', () => {
  test('lists every changed file once, sorted, with the marked ones ticked', () => {
    assert.deepEqual(shown(setup().dialog.html()), [
      ['a&lt;1&gt;.txt', false], ['b.txt', true], ['c.txt', false], ['new.txt', false],
    ]);
  });

  test('a rename takes its old path along', () => {
    const { dialog, sent } = setup(['new.txt']);
    dialog.save('');
    assert.deepEqual(sent[0].paths, ['new.txt', 'old.txt']);
  });

  test('closing forgets the choice', () => {
    const { dialog } = setup();
    dialog.close();
    assert.equal(dialog.isOpen, false);
    assert.equal(dialog.canSave, false);
  });
});
