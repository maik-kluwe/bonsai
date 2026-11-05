import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { de, en } from '../i18n';

const media = path.join(__dirname, '..', '..', 'media');

/** Keys the webview scripts ask t() for: plain literals, both branches of a ternary, toolbar tips and the change labels. */
function usedKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const m of source.matchAll(/\bt\('(\w+)'/g)) keys.add(m[1]);
  for (const m of source.matchAll(/\bt\([^?()]*\? '(\w+)' : '(\w+)'/g)) { keys.add(m[1]); keys.add(m[2]); }
  for (const m of source.matchAll(/\bbtn\('\w+', '\w+', '(\w+)'/g)) keys.add(m[1]);
  for (const m of source.matchAll(/CHANGE_KEY = \{([^}]*)\}/g)) for (const k of m[1].matchAll(/'(\w+)'/g)) keys.add(k[1]);
  return [...keys];
}

describe('texts of the webview', () => {
  const files = readdirSync(media).filter(f => f.endsWith('.js'));
  test('the scan finds keys at all', () => {
    assert.ok(files.flatMap(f => usedKeys(readFileSync(path.join(media, f), 'utf8'))).length > 50);
  });
  test('every script only asks for texts that exist in both languages', () => {
    for (const f of files) {
      for (const key of usedKeys(readFileSync(path.join(media, f), 'utf8'))) {
        assert.ok(key in en, `${f}: ${key} is missing in en`);
        assert.ok(key in de, `${f}: ${key} is missing in de`);
      }
    }
  });
});
