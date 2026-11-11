import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { avatarHashes, gravatarHash } from '../avatars';
import { pageHtml } from '../pageHtml';

const { initials, hue, HUES }: { initials(n: string): string; hue(k: string): number; HUES: number } = require('../../media/avatar.js');

describe('initials', () => {
  test('first and last word, upper-cased, whole letters, a placeholder for no name', () => {
    assert.equal(initials('Ada Lovelace'), 'AL', 'two words');
    assert.equal(initials('ada'), 'A', 'one word');
    assert.equal(initials('  grace   brewster  hopper '), 'GH', 'first and last');
    assert.equal(initials('Émile Zola'), 'ÉZ', 'beyond ASCII');
    assert.equal(initials('𝔄da 𝔏ovelace').length, 4, 'two astral letters, two UTF-16 units each');
    assert.equal(initials(''), '?', 'empty');
    assert.equal(initials('   '), '?', 'only spaces');
  });
});

describe('hue', () => {
  test('stays within the colour classes and does not depend on case or spaces', () => {
    for (const k of ['a@x.org', 'B@X.ORG', '', 'Ünï@cödé.de']) assert.ok(hue(k) >= 0 && hue(k) < HUES, k);
    assert.equal(hue(' Ada@Example.org '), hue('ada@example.org'));
  });

  test('different people spread over several colours', () => {
    const used = new Set(Array.from({ length: 40 }, (_, i) => hue(`person${i}@example.org`)));
    assert.ok(used.size > 8, `only ${used.size} colours`);
  });

  test('main.css has a class for every colour', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../media/main.css'), 'utf8');
    for (let i = 0; i < HUES; i++) assert.match(css, new RegExp(`\.av\.h${i} \{`), `h${i}`);
  });
});

describe('Gravatar hashes', () => {
  test('SHA-256 of the trimmed, lower-cased email (the example from the Gravatar documentation)', () => {
    const want = '84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee';
    assert.equal(gravatarHash('myemailaddress@example.com'), want);
    assert.equal(gravatarHash('  MyEmailAddress@Example.COM '), want);
  });

  test('one entry per distinct email, keyed the way the webview looks it up; empty emails are left out', () => {
    const out = avatarHashes([{ email: 'A@x.org' }, { email: ' a@x.org' }, { email: 'b@x.org' }, { email: '' }]);
    assert.deepEqual(Object.keys(out).sort(), ['a@x.org', 'b@x.org']);
    assert.equal(out['a@x.org'], gravatarHash('a@x.org'));
  });
});

describe('wiring', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

  test('Gravatar is off by default and the page may only load images from gravatar.com when it is on', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.contributes.configuration.properties['bonsai.gravatar'].default, false);
    const panel = read('src/panel.ts');
    const csp = (gravatar: boolean) => /Content-Security-Policy" content="([^"]*)"/.exec(pageHtml({ nonce: 'n', cspSource: 'c', css: 'main.css', uri: f => f, gravatar }))?.[1] ?? '';
    assert.match(csp(false), /img-src data:;/, 'off: only pictures sent by the host (data:), nothing from outside');
    assert.match(csp(true), /img-src data: https:\/\/gravatar\.com https:\/\/\*\.gravatar\.com;/);
    assert.match(panel, /pageHtml\(\{[^}]*gravatar: this\.gravatar/s, 'the panel passes the setting on');
    assert.match(panel, /this\.gravatar \? \{ \.\.\.snapshot, avatars: avatarHashes/);
    for (const f of ['package.nls.json', 'package.nls.de.json']) assert.ok(JSON.parse(read(f))['config.gravatar'], f);
  });
});
