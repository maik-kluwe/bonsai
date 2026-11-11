import { afterEach, describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync, rmSync } from 'fs';
import * as path from 'path';
import { Scenario } from './scenario';
import { png } from './png';

// README, "Compare pictures": a changed picture is drawn, not described as "binary file". Side by side, Swipe, Onion Skin.

let s: Scenario;
afterEach(() => s?.dispose());

const RED = png(2, 2, [255, 0, 0]);
const BLUE = png(3, 3, [0, 0, 255]);
const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;

/** A commit that changes logo.png, adds new.png and deletes gone.png, open in the Changes tab of the details. */
async function commitWithPictures() {
  s = new Scenario();
  const { t } = s.h;
  t.write('logo.png', RED); t.write('gone.png', RED); t.commit('add pictures');
  t.write('logo.png', BLUE); t.write('new.png', BLUE); t.git('rm', '-q', 'gone.png'); t.commit('change pictures');
  await s.h.repo.status();
  await s.open();
  await s.click('#refresh');
  await s.click('.row[data-i="0"]');
  await s.click('.dtabs button[data-tab="changes"]');
}

const showFile = (name: string) => {
  const li = [...s.page.document.querySelectorAll('#details .file')].find(e => e.textContent?.includes(name));
  assert.ok(li, `${name} is in the list`);
  return s.click(`#details .file[data-i="${(li as HTMLElement).dataset.i}"]`);
};
const sources = () => [...s.page.document.querySelectorAll('.imgdiff img')].map(i => i.getAttribute('src'));
const caps = () => [...s.page.document.querySelectorAll('.imgdiff .cap')].map(c => c.textContent);

describe('a changed picture in a commit', () => {
  test('shows the old and the new picture side by side, with their sizes once they are loaded', async () => {
    await commitWithPictures();
    await showFile('logo.png');
    assert.deepEqual(sources(), [dataUrl(RED), dataUrl(BLUE)], 'old on the left, new on the right, the bytes of the commits');
    assert.deepEqual(caps(), ['old', 'new']);
    assert.equal(s.page.$('.imgdiff').dataset.mode, 'side');
    assert.doesNotMatch(s.page.text('#details'), /Binary file/);

    const img = s.page.document.querySelector('.imgdiff .pane.new img')!;   // jsdom loads no pictures: say what the browser would
    Object.defineProperty(img, 'naturalWidth', { value: 3 }); Object.defineProperty(img, 'naturalHeight', { value: 3 });
    img.dispatchEvent(new s.page.dom.window.Event('load'));
    assert.match(s.page.text('.imgdiff .meta.new'), /^W: 3px \| H: 3px \(\d+ Bytes\)$/);
    assert.deepEqual(s.page.errors, []);
  });

  test('Swipe puts both on top of each other behind a line that follows the pointer; Onion Skin fades the new one in', async () => {
    await commitWithPictures();
    await showFile('logo.png');
    const order = s.page.$('.imgdiff .pane.old').compareDocumentPosition(s.page.$('.imgdiff .pane.new'));
    assert.ok(order & s.page.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the old picture comes first, so the new one lies over it');
    assert.equal(s.page.$<HTMLInputElement>('.imgdiff input.onion').value, '100', 'Onion Skin starts with the new picture only');
    const css = readFileSync(path.join(__dirname, '..', '..', 'media', 'main.css'), 'utf8');
    assert.match(css, /\.imgdiff\[data-mode="swipe"] \.pane\.new \{ clip-path: inset\(0 0 0 var\(--pos\)\); }/, 'the line cuts off the new picture on its left: old is left of the line, new right of it');
    assert.match(css, /\.imgdiff \{ --pos: 50%; --op: 1;/, 'and the defaults are the middle and the new picture at full strength');
    await s.click('.imgdiff [data-imgmode="swipe"]');
    const d = s.page.$('.imgdiff');
    assert.equal(d.dataset.mode, 'swipe');
    assert.equal(s.page.$('.imgdiff [data-imgmode="swipe"]').classList.contains('on'), true);

    const stage = s.page.$('.imgdiff .stage');
    stage.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
    stage.dispatchEvent(new s.page.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 150 }));
    assert.equal(d.style.getPropertyValue('--pos'), '25%', 'the line is a quarter into the picture');
    s.page.document.dispatchEvent(new s.page.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 400 }));
    assert.equal(d.style.getPropertyValue('--pos'), '100%', 'and stops at the edge');
    s.page.document.dispatchEvent(new s.page.dom.window.MouseEvent('pointerup', { bubbles: true }));
    s.page.document.dispatchEvent(new s.page.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 120 }));
    assert.equal(d.style.getPropertyValue('--pos'), '100%', 'a released line stays');

    await s.click('.imgdiff [data-imgmode="onion"]');
    assert.equal(d.dataset.mode, 'onion');
    const slider = s.page.$<HTMLInputElement>('.imgdiff input.onion');
    slider.value = '40';
    slider.dispatchEvent(new s.page.dom.window.Event('input', { bubbles: true }));
    assert.equal(d.style.getPropertyValue('--op'), '0.4');
    assert.deepEqual(s.page.errors, []);
  });

  test('both pictures shrink by the same factor when the pane is too narrow, and again when the mode or the width changes', async () => {
    await commitWithPictures();
    await showFile('logo.png');
    const d = s.page.$('.imgdiff');
    Object.defineProperty(d, 'clientWidth', { configurable: true, value: 432 });   // 400 pixels of room after the padding
    const sizes = [300, 360];
    s.page.document.querySelectorAll('.imgdiff img').forEach((img, i) => {
      Object.defineProperty(img, 'naturalWidth', { value: sizes[i] });
      img.dispatchEvent(new s.page.dom.window.Event('load'));
    });
    const scale = () => Number(d.style.getPropertyValue('--scale'));
    assert.ok(Math.abs(scale() - 336 / 660) < 1e-9, 'side by side: 400 minus two frames and the gap, over both widths');
    assert.equal(s.page.$<HTMLImageElement>('.imgdiff .pane.new img').style.getPropertyValue('--w'), '360px', 'the picture knows its own width');

    await s.click('.imgdiff [data-imgmode="swipe"]');
    assert.equal(scale(), 1, 'one over the other, the larger one (360) fits into 400');
    Object.defineProperty(d, 'clientWidth', { configurable: true, value: 212 });
    await s.click('.imgdiff [data-imgmode="onion"]');
    assert.ok(Math.abs(scale() - 180 / 360) < 1e-9, 'a narrower pane: half of the larger picture');
    assert.deepEqual(s.page.errors, []);
  });

  test('the mode chosen stays for the next picture', async () => {
    await commitWithPictures();
    await showFile('logo.png');
    await s.click('.imgdiff [data-imgmode="swipe"]');
    await showFile('new.png');
    await showFile('logo.png');
    assert.equal(s.page.$('.imgdiff').dataset.mode, 'swipe');
  });

  test('a created picture is shown alone, a removed one too, each without modes', async () => {
    await commitWithPictures();
    await showFile('new.png');
    assert.deepEqual(sources(), [dataUrl(BLUE)]);
    assert.deepEqual(caps(), ['created']);
    assert.equal(s.page.document.querySelector('.imgdiff [data-imgmode]'), null, 'nothing to compare');
    await showFile('gone.png');
    assert.deepEqual(sources(), [dataUrl(RED)]);
    assert.deepEqual(caps(), ['removed']);
  });

  test('is drawn in the file list of the Commit tab as well', async () => {
    await commitWithPictures();
    await s.click('.dtabs button[data-tab="commit"]');
    await showFile('logo.png');
    assert.deepEqual(sources(), [dataUrl(RED), dataUrl(BLUE)]);
  });

  test('a picture over the limit is not sent, its size is', async () => {
    s = new Scenario();
    const big = Buffer.concat([png(1, 1, [0, 0, 0]), Buffer.alloc(9 * 1024 * 1024)]);
    s.h.t.write('big.png', png(1, 1, [1, 1, 1])); s.h.t.commit('small');
    s.h.t.write('big.png', big); s.h.t.commit('big');
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');
    await s.click('.row[data-i="0"]');
    await s.click('.dtabs button[data-tab="changes"]');
    assert.deepEqual(sources(), [dataUrl(png(1, 1, [1, 1, 1]))], 'the old one is small enough');
    assert.match(s.page.text('.imgdiff .pane.new'), /Too large to show \(9 MB\)/);
  });
});

describe('the other kinds of commits', () => {
  /** Opens the details of the row whose text contains `text` and its Changes tab. */
  async function openRow(text: string) {
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');
    const i = s.page.rows().findIndex(r => r.includes(text));
    assert.ok(i >= 0, `a row with ${text}`);
    await s.click(`.row[data-i="${i}"]`);
    await s.click('.dtabs button[data-tab="changes"]');
  }

  test('a stash: the picture at its base against the picture it saved', async () => {
    s = new Scenario();
    const { t } = s.h;
    t.write('logo.png', RED); t.commit('add logo');
    t.write('logo.png', BLUE); t.git('stash', 'push', '-q', '-m', 'parked');
    await openRow('parked');
    await showFile('logo.png');
    assert.deepEqual(sources(), [dataUrl(RED), dataUrl(BLUE)]);
  });

  test('a merge commit: the picture against the first parent', async () => {
    s = new Scenario();
    const { t } = s.h;
    t.write('logo.png', RED); t.commit('add logo');
    t.git('checkout', '-q', '-b', 'feature');
    t.write('logo.png', BLUE); t.commit('blue logo');
    t.git('checkout', '-q', 'main');
    t.write('other.txt', 'x\n'); t.commit('main moves on');
    t.git('merge', '--no-ff', '-q', '-m', 'merge feature', 'feature');
    await openRow('merge feature');
    await showFile('logo.png');
    assert.deepEqual(sources(), [dataUrl(RED), dataUrl(BLUE)]);
  });
});

describe('a changed picture in Local Changes', () => {
  async function localPictures() {
    s = new Scenario();
    const { t } = s.h;
    t.write('logo.png', RED); t.commit('add logo');
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');
    await s.click('.nav-item[data-view="changes"]');
  }

  test('compares the index with the file when it is not staged, HEAD with the index when it is', async () => {
    await localPictures();
    s.h.t.write('logo.png', BLUE);
    await s.click('#refresh');
    await s.click('#unstaged li');
    assert.deepEqual(sources(), [dataUrl(RED), dataUrl(BLUE)]);

    s.h.t.git('add', 'logo.png');
    s.h.t.write('logo.png', png(4, 4, [0, 255, 0]));
    await s.click('#refresh');
    await s.click('#staged li');
    assert.deepEqual(sources(), [dataUrl(RED), dataUrl(BLUE)], 'staged: the commit against what was added');
    await s.click('#unstaged li');
    assert.deepEqual(sources(), [dataUrl(BLUE), dataUrl(png(4, 4, [0, 255, 0]))], 'unstaged: what was added against the file');
    assert.deepEqual(s.page.errors, []);
  });

  test('shows a new picture alone', async () => {
    await localPictures();
    s.h.t.write('fresh.png', BLUE);
    await s.click('#refresh');
    await s.click('#unstaged li');
    assert.deepEqual(sources(), [dataUrl(BLUE)]);
    assert.deepEqual(caps(), ['created']);
  });

  test('keeps the text diff for a file that is not a picture, and the note for binaries that are not pictures', async () => {
    await localPictures();
    s.h.t.write('data.bin', Buffer.from([0, 1, 2, 3])); s.h.t.git('add', 'data.bin'); s.h.t.commit('bin');
    s.h.t.write('data.bin', Buffer.from([0, 1, 2, 4]));
    await s.click('#refresh');
    await s.click('#unstaged li');
    assert.equal(s.page.document.querySelector('.imgdiff'), null);
    assert.match(s.page.text('#diff'), /Binary file/);
  });

  test('a staged rename with a change: the old file at HEAD against the new one in the index', async () => {
    // Git only calls it a rename when the files are alike: the same bytes behind the picture (ignored after the end of a PNG) make them so
    const ballast = Buffer.alloc(4000, 7);
    const before = Buffer.concat([RED, ballast]);
    const after = Buffer.concat([BLUE, ballast]);
    s = new Scenario();
    s.h.t.write('logo.png', before); s.h.t.commit('add logo');
    await s.h.repo.status();
    await s.open();
    await s.click('#refresh');
    await s.click('.nav-item[data-view="changes"]');
    s.h.t.git('mv', 'logo.png', 'brand.png');
    s.h.t.write('brand.png', after); s.h.t.git('add', 'brand.png');
    assert.match(s.h.t.git('status', '--porcelain'), /^R/, 'Git sees a rename');
    await s.click('#refresh');
    await s.click('#staged li');
    assert.deepEqual(sources(), [dataUrl(before), dataUrl(after)]);
    assert.deepEqual(caps(), ['old', 'new']);
  });

  test('a picture deleted in the working tree shows what the index still has, as removed', async () => {
    await localPictures();
    rmSync(path.join(s.h.t.dir, 'logo.png'));
    await s.click('#refresh');
    await s.click('#unstaged li');
    assert.deepEqual(sources(), [dataUrl(RED)]);
    assert.deepEqual(caps(), ['removed']);
  });
});

