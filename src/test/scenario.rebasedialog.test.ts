import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { answerRebase } from '../rebaseDialog';
import { FlowHarness } from './flowHarness';
import { WebviewPage } from './dom';

// README, "Rewrite history": the interactive rebase in its own window. The real page, the real answers of the host,
// a real repository. The window is opened from the menu of a commit (scenario.rewrite.test.ts).

let h: FlowHarness;
let page: WebviewPage;
let closed: boolean;
let pending: Promise<void>[];
afterEach(() => { page?.close(); h?.dispose(); });

/** main with base, first, second, third; the dialog is opened on "first", so it holds the last three. */
async function openDialog(opts: { dirty?: boolean } = {}) {
  h = new FlowHarness();
  const { t } = h;
  t.write('a.txt', '0\n'); t.commit('base');
  for (const n of ['first', 'second', 'third']) { t.write(`${n}.txt`, n); t.commit(n); }
  if (opts.dirty) t.write('a.txt', 'dirty\n');
  await h.repo.status();
  const range = await h.svc.rebaseRange(t.git('rev-parse', 'HEAD~2').trim());
  closed = false;
  pending = [];
  const dialog = { range, svc: h.svc, repo: h.repo as never, ui: h.ui, track: <T>(run: () => Promise<T>) => run(), post: (m: unknown) => page.send(m as { type: string }), close: () => { closed = true; } };
  page = new WebviewPage(m => { pending.push(Promise.resolve().then(() => answerRebase(m as never, dialog))); }, 'rebase');
  await settle();
}

const settle = async () => { while (pending.length) await pending.shift(); };
const rows = () => [...page.document.querySelectorAll('#rows .row')];
const subjectsOnPage = () => rows().map(r => r.querySelector('.subject')?.textContent?.replace('└ ', '').trim());
const log = () => h.t.git('log', '--format=%s').trim().split('\n');

async function choose(d: number, action: string) {
  const select = page.$<HTMLSelectElement>(`#rows select[data-d="${d}"]`);
  select.value = action;
  select.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
}
const start = async () => { page.$('#start').click(); await settle(); };

describe('the dialog', () => {
  test('lists the commits newest first, all as Pick, and ticks Autostash only with local changes', async () => {
    await openDialog();
    assert.match(page.text('#title'), /main/);
    assert.deepEqual(subjectsOnPage(), ['third', 'second', 'first']);
    assert.ok(rows().every(r => r.classList.contains('pick')));
    assert.equal(page.$<HTMLInputElement>('#autostash').checked, false);
    page.close(); h.dispose();

    await openDialog({ dirty: true });
    assert.equal(page.$<HTMLInputElement>('#autostash').checked, true, 'a rebase would be refused otherwise');
  });

  test('Cancel closes it and changes nothing', async () => {
    await openDialog();
    page.$('#cancel').click();
    await settle();
    assert.equal(closed, true);
    assert.deepEqual(log(), ['third', 'second', 'first', 'base']);
  });
});

describe('the plan', () => {
  test('drops, squashes and reorders, and Start rewrites the branch that way', async () => {
    await openDialog();
    // rows are newest first: 0 third, 1 second, 2 first. Drop "second", squash "third" into "first".
    await choose(1, 'drop');
    await choose(0, 'fixup');
    await start();
    assert.equal(closed, true);
    assert.deepEqual(log(), ['first', 'base'], 'second is gone, third is melted into first');
    assert.equal(h.t.git('show', '--stat', '--format=', 'HEAD').includes('third.txt'), true, 'but its change is kept');
    assert.deepEqual(h.ui.errors, []);
  });

  test('moves a commit with the arrows', async () => {
    await openDialog();
    page.$('[data-up="2"]').click(); // "first" one place up
    assert.deepEqual(subjectsOnPage(), ['third', 'first', 'second']);
    page.$('[data-up="1"]').click(); // and once more, to the newest place
    await start();
    assert.deepEqual(log(), ['first', 'third', 'second', 'base']);
  });

  test('rewords with the message typed into the box that opens', async () => {
    await openDialog();
    await choose(1, 'reword');
    const box = page.$<HTMLTextAreaElement>('#rows textarea[data-d="1"]');
    box.value = 'second, better said';
    box.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    await start();
    assert.deepEqual(log(), ['third', 'second, better said', 'first', 'base']);
  });
});

describe('what the dialog refuses', () => {
  test('a plan that drops everything, or starts with a squash, says why and does not start', async () => {
    await openDialog();
    for (const d of [0, 1, 2]) await choose(d, 'drop');
    await start();
    assert.notEqual(page.text('#error'), '', 'an explanation is shown');
    assert.equal(closed, false, 'the dialog stays open');
    assert.deepEqual(log(), ['third', 'second', 'first', 'base'], 'and nothing happened');

    await choose(0, 'pick'); await choose(1, 'pick');
    await choose(2, 'squash'); // the oldest cannot melt into anything
    await start();
    assert.notEqual(page.text('#error'), '');
    assert.equal(closed, false);
  });
});
