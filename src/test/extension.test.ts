import { test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';

const read = (rel: string) => readFileSync(path.join(__dirname, rel), 'utf8');

test('the status bar item runs the command that package.json contributes', () => {
  const src = read('../../src/extension.ts');
  const pkg = JSON.parse(read('../../package.json'));
  const command = /statusItem\.command = '([^']+)'/.exec(src)?.[1];
  assert.ok(command, 'extension.ts sets no command on the status bar item');
  assert.ok(pkg.contributes.commands.some((c: { command: string }) => c.command === command), `${command} is not contributed`);
  assert.ok(src.includes(`registerCommand('${command}'`), `${command} is not registered`);
  assert.ok(src.includes('statusItem.show()') && src.includes('statusItem,'), 'status bar item is never shown or not disposed with the extension');
});
