import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createConflictDialog }: { createConflictDialog(deps: any): any } = require('../../media/conflictdialog.js');
const { esc }: { esc(s: string): string } = require('../../media/diffhtml.js');

const t = (k: string, ...a: unknown[]) => `${k}${a.length ? `(${a.join(',')})` : ''}`;
const open = (files: string[], output = 'Auto-merging a.txt\nCONFLICT (content): Merge conflict in a.txt') => {
  const dialog = createConflictDialog({ t, esc });
  dialog.open({ files, output });
  return dialog;
};

describe('conflict dialog', () => {
  test('a long list is cut', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.txt`);
    const html = open(files).html();
    assert.equal(html.match(/<li title/g)?.length, 12);
    assert.match(html, /<li class="more">\+8<\/li>/);
  });

  test('without files or output there is no empty box', () => {
    const html = open([], '  \n').html();
    assert.doesNotMatch(html, /cfiles/);
    assert.doesNotMatch(html, /<details/);
    assert.match(html, /data-cact="resolve"/, 'the way on is still there');
  });

  test('names and output from the repository cannot break the page', () => {
    const html = open(['<img src=x onerror=1>.txt'], '<script>alert(1)</script>').html();
    assert.doesNotMatch(html, /<img|<script>/);
  });

  test('closed: nothing', () => {
    const dialog = open(['a.txt']);
    assert.equal(dialog.isOpen, true);
    dialog.close();
    assert.equal(dialog.isOpen, false);
    assert.equal(dialog.html(), '');
  });
});
