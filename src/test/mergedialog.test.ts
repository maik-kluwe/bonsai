import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createMergeDialog }: { createMergeDialog(deps: { post: (m: any) => void; createResolution: any }): any } = require('../../media/mergedialog.js');
const { createResolution } = require('../../media/mergeresolve.js');

const names = { ours: 'main', theirs: 'feat' };
const inputs = (path: string, extra = {}) => ({
  path,
  result: {
    ok: true, eol: '\n', finalNewline: true,
    segments: [
      { t: 'text', lines: ['top'] },
      { t: 'conflict', ours: ['a'], theirs: ['b'] },
      { t: 'text', lines: ['mid'] },
      { t: 'conflict', ours: ['c'], theirs: ['d'] },
    ],
    ...extra,
  },
});

function setup() {
  const sent: any[] = [];
  const dialog = createMergeDialog({ post: (m: any) => sent.push(m), createResolution });
  return { dialog, sent };
}

describe('merge dialog: opening and answers', () => {
  test('is closed at first; opening asks the host for the inputs', () => {
    const { dialog, sent } = setup();
    assert.equal(dialog.isOpen, false);
    dialog.open('a.txt');
    assert.equal(dialog.isOpen, true);
    assert.equal(dialog.path, 'a.txt');
    assert.equal(dialog.state, null);
    assert.deepEqual(sent, [{ type: 'mergeInputs', path: 'a.txt' }]);
  });

  test('inputs build the resolution for the file the dialog was opened for', () => {
    const { dialog } = setup();
    dialog.open('a.txt');
    assert.deepEqual(dialog.receive(inputs('a.txt'), names), { ready: true });
    assert.equal(dialog.state.path, 'a.txt');
    assert.equal(dialog.state.res.total, 2);
    assert.equal(dialog.state.view, 'auto');
    assert.equal(dialog.state.cur, 0);
  });

  test('inputs count only while the dialog is open for that very file', () => {
    const { dialog } = setup();
    assert.deepEqual(dialog.receive(inputs('a.txt'), names), { stale: true });
    dialog.open('a.txt');
    assert.deepEqual(dialog.receive(inputs('b.txt'), names), { stale: true });
    dialog.close();
    assert.deepEqual(dialog.receive(inputs('a.txt'), names), { stale: true });
    assert.equal(dialog.state, null);
  });

  test('a file that cannot be merged here closes the dialog and says why', () => {
    const { dialog } = setup();
    dialog.open('a.txt');
    assert.deepEqual(dialog.receive({ path: 'a.txt', result: { ok: false, reason: 'binary' } }, names), { refused: 'binary' });
    assert.equal(dialog.isOpen, false);
  });

  test('the branch names end up in the markers of a conflict nobody decided', () => {
    const { dialog } = setup();
    dialog.open('a.txt');
    dialog.receive(inputs('a.txt'), names);
    const text = dialog.state.res.lines ? dialog.state.res.lines().join('\n') : dialog.state.res.content();
    assert.match(text, /<<<<<<< main/);
    assert.match(text, />>>>>>> feat/);
  });

  test('opening another file drops the first one', () => {
    const { dialog } = setup();
    dialog.open('a.txt');
    dialog.receive(inputs('a.txt'), names);
    dialog.open('b.txt');
    assert.equal(dialog.state, null);
    assert.deepEqual(dialog.receive(inputs('a.txt'), names), { stale: true });
  });
});

describe('merge dialog: choosing and resolving', () => {
  const ready = () => {
    const t = setup();
    t.dialog.open('a.txt');
    t.dialog.receive(inputs('a.txt'), names);
    t.sent.length = 0;
    return t;
  };

  test('resolving is not possible while a conflict is open', () => {
    const { dialog, sent } = ready();
    dialog.choose(0, 'ours', true);
    assert.equal(dialog.resolve(), false);
    assert.equal(dialog.isOpen, true);
    assert.deepEqual(sent, []);
  });

  test('take-all decides every conflict; resolving sends the content and closes', () => {
    const { dialog, sent } = ready();
    dialog.takeAll('theirs', true);
    assert.equal(dialog.state.res.canResolve(), true);
    assert.equal(dialog.resolve(), true);
    assert.deepEqual(sent, [{ type: 'mergeResolve', path: 'a.txt', content: 'top\nb\nmid\nd\n' }]);
    assert.equal(dialog.isOpen, false);
  });

  test('hand editing: toggling flips the view, typing sets the text, the text is what is written; going back returns to the selection', () => {
    const { dialog, sent } = ready();
    dialog.toggleManual();
    assert.equal(dialog.state.res.isManual(), true);
    assert.equal(dialog.state.view, 'auto'); // forces the view to build the text field
    dialog.setManual('by hand\n');
    dialog.resolve();
    assert.equal(sent[0].content, 'by hand\n');
    const back = ready().dialog;
    back.toggleManual();
    back.toggleManual();
    assert.equal(back.state.res.isManual(), false);
    assert.equal(back.state.view, 'manual');
  });

  test('the conflict to look at wraps around, and there is none when there are none', () => {
    const { dialog } = ready();
    assert.equal(dialog.goTo(0), 0);
    assert.equal(dialog.step(1), 1);
    assert.equal(dialog.step(1), 0);
    assert.equal(dialog.step(-1), 1);
    const empty = setup();
    empty.dialog.open('x');
    empty.dialog.receive(inputs('x', { segments: [{ t: 'text', lines: ['only'] }] }), names);
    assert.equal(empty.dialog.goTo(0), -1);
    assert.equal(empty.dialog.step(1), -1);
  });

  test('everything is a no-op without inputs', () => {
    const { dialog, sent } = setup();
    dialog.open('a.txt');
    sent.length = 0;
    dialog.choose(0, 'ours', true);
    dialog.takeAll('ours', true);
    dialog.setManual('x');
    dialog.toggleManual();
    assert.equal(dialog.goTo(0), -1);
    assert.equal(dialog.resolve(), false);
    assert.deepEqual(sent, []);
  });
});
