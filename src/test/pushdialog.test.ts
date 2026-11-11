import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { createPushDialog, targets, splitLinks }: { createPushDialog(deps: any): any; targets(b: string, d: any): any[]; splitLinks(s: string): any[] } = require('../../media/pushdialog.js');
const { esc }: { esc(s: string): string } = require('../../media/diffhtml.js');

const data = {
  remotes: ['origin', 'my/fork'],
  refs: [
    { kind: 'head', name: 'main', upstream: 'origin/main' },
    { kind: 'head', name: 'new/thing' },
    { kind: 'remote', name: 'origin/HEAD' },
    { kind: 'remote', name: 'origin/main' },
    { kind: 'remote', name: 'origin/feat/x' },
    { kind: 'remote', name: 'my/fork/main' },
    { kind: 'tag', name: 'v1' },
  ],
};

function setup(branch: string | undefined = 'main', d: any = data) {
  const sent: any[] = [];
  const t = (k: string, ...a: unknown[]) => `${k}${a.length ? `(${a.join(',')})` : ''}`;
  const dialog = createPushDialog({ t, esc, post: (m: any) => sent.push(m) });
  dialog.open(branch, d);
  return { dialog, sent };
}
const options = (html: string, id: string) =>
  [...html.split(`id="${id}"`)[1].split('</select>')[0].matchAll(/<option[^>]*?( selected)?>([^<]*)/g)].map(m => [m[2], !!m[1]]);

describe('push targets', () => {
  test('a branch with an upstream goes there by default, the other remote branches follow', () => {
    assert.deepEqual(targets('main', data), [
      { kind: 'default', remote: 'origin', branch: 'main' },
      { kind: 'existing', remote: 'origin', branch: 'main' },
      { kind: 'existing', remote: 'origin', branch: 'feat/x' },
      { kind: 'existing', remote: 'my/fork', branch: 'main' },
    ]);
  });

  test('a branch without one is offered as new on every remote; a slash in the name stays', () => {
    assert.deepEqual(targets('new/thing', data).slice(0, 2), [
      { kind: 'new', remote: 'origin', branch: 'new/thing' },
      { kind: 'new', remote: 'my/fork', branch: 'new/thing' },
    ]);
  });

  test('without a remote there is nowhere to go', () => {
    assert.deepEqual(targets('main', { refs: [{ kind: 'head', name: 'main' }], remotes: [] }), []);
  });
});

describe('push dialog', () => {
  test('starts on the current branch and its upstream, with nothing ticked; a new branch offers tracking, ticked, as Fork does', () => {
    const html = setup().dialog.html();
    assert.deepEqual(options(html, 'pbranch'), [['main', true], ['new/thing', false]]);
    assert.deepEqual(options(html, 'ptarget')[0], ['pushDefault(origin/main)', true]);
    assert.doesNotMatch(html, /data-popt="track"/);
    assert.doesNotMatch(html, /checked/);
    const fresh = setup('new/thing').dialog.html();
    assert.deepEqual(options(fresh, 'ptarget')[0], ['pushNew(origin/new/thing)', true]);
    assert.match(fresh, /data-popt="track" checked/);
  });

  test('the choices reach the message', () => {
    const { dialog, sent } = setup('new/thing');
    dialog.setOption('track', false);
    dialog.setOption('tags', true);
    dialog.setOption('force', true);
    dialog.setTarget(1);
    dialog.push();
    assert.deepEqual(sent[0], { type: 'push', branch: 'new/thing', remote: 'my/fork', remoteBranch: 'new/thing', track: false, tags: true, force: true });
  });

  test('another branch starts over at its own default', () => {
    const { dialog, sent } = setup();
    dialog.setTarget(2);
    dialog.setBranch('new/thing');
    dialog.push();
    assert.deepEqual(sent[0], { type: 'push', branch: 'new/thing', remote: 'origin', remoteBranch: 'new/thing', track: true, tags: false, force: false });
  });

  test('tracking is not sent for a branch that already has an upstream', () => {
    const { dialog, sent } = setup();
    dialog.setOption('track', true);
    dialog.push();
    assert.equal(sent[0].track, false);
  });

  test('no branch (detached HEAD) or no remote: nothing to push', () => {
    const detached = setup(null as unknown as undefined);
    assert.equal(detached.dialog.canPush, false);
    assert.equal(detached.dialog.push(), false);
    assert.match(detached.dialog.html(), /data-pact="push" disabled/);
    const none = setup('main', { refs: [{ kind: 'head', name: 'main' }], remotes: [] });
    assert.equal(none.dialog.push(), false);
    assert.deepEqual(none.sent, []);
  });
});

describe('push result', () => {
  const gitlab = 'remote: To create a merge request for x, visit:\nremote:   https://gitlab.example.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=x\nremote:\n';

  test('finds the link in what the server said', () => {
    const parts = splitLinks(gitlab);
    assert.equal(parts[1].url, 'https://gitlab.example.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=x');
    assert.equal(parts.map(p => p.text ?? p.url).join(''), gitlab);
  });

  test('a dot or bracket behind a link stays text', () => {
    assert.deepEqual(splitLinks('see (https://a.example/b).'), [{ text: 'see (' }, { url: 'https://a.example/b' }, { text: ').' }]);
  });

  test('text is escaped, also in the link', () => {
    const html = setup().dialog.resultHtml('<b> https://a.example/?x=1&y=2');
    assert.match(html, /&lt;b&gt; <a href="#" data-url="https:\/\/a\.example\/\?x=1&amp;y=2">/);
  });
});
