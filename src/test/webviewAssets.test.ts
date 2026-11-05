import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readdirSync } from 'fs';
import * as path from 'path';
import { MAIN_SCRIPTS, REBASE_SCRIPTS, scriptTags } from '../webviewAssets';

const media = path.join(__dirname, '..', '..', 'media');

describe('webview scripts', () => {
  test('every script in media/ is loaded by a page, and every loaded script exists', () => {
    const files = readdirSync(media).filter(f => f.endsWith('.js')).sort();
    assert.deepEqual([...MAIN_SCRIPTS, ...REBASE_SCRIPTS].sort(), files);
  });
  test('main.js comes last, after the helpers it uses', () => {
    assert.equal(MAIN_SCRIPTS[MAIN_SCRIPTS.length - 1], 'main.js');
    assert.ok(MAIN_SCRIPTS.indexOf('look.js') < MAIN_SCRIPTS.indexOf('main.js'));
  });
  test('scriptTags writes one tag per file with the nonce', () => {
    assert.equal(scriptTags(['a.js', 'b.js'], 'N', f => `x/${f}`), '  <script nonce="N" src="x/a.js"></script>\n  <script nonce="N" src="x/b.js"></script>');
  });
});
