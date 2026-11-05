import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import * as path from 'path';
import { isInside, repoRelative } from '../paths';

describe('repoRelative', () => {
  test('Windows and POSIX: "/" as separator, umlauts and spaces stay, case of drive and folders does not matter', () => {
    const win = 'C:\\Users\\Maik\\repo';
    const cases: [string, string, path.PlatformPath, string][] = [
      [win, 'C:\\Users\\Maik\\repo\\Ordner mit Ümläut\\Datei ä ö.txt', path.win32, 'Ordner mit Ümläut/Datei ä ö.txt'],
      [win, 'C:\\Users\\Maik\\repo\\a.txt', path.win32, 'a.txt'],
      ['c:\\users\\maik\\repo', 'C:\\Users\\Maik\\repo\\src\\x.ts', path.win32, 'src/x.ts'],
      ['/home/m/repo', '/home/m/repo/src/x.ts', path.posix, 'src/x.ts'],
    ];
    for (const [root, file, flavour, want] of cases) assert.equal(repoRelative(root, file, flavour), want, file);
  });
});

describe('isInside', () => {
  test('files in the repo pass, also nested, odd or starting with ".."; paths leading out do not', () => {
    const cases: [string, string, path.PlatformPath, boolean][] = [
      ['C:\\r', 'a.txt', path.win32, true],
      ['C:\\r', 'sub\\Ümläut ß.txt', path.win32, true],
      ['/r', 'sub/a.txt', path.posix, true],
      ['/r', '..hidden.txt', path.posix, true],
      ['C:\\r', '..hidden.txt', path.win32, true],
      ['/r', '../outside.txt', path.posix, false],
      ['/r', 'sub/../../outside.txt', path.posix, false],
      ['/r', '/etc/passwd', path.posix, false],
      ['C:\\r', '..\\outside.txt', path.win32, false],
      ['C:\\r', 'D:\\other\\x.txt', path.win32, false],
    ];
    for (const [root, file, flavour, inside] of cases) assert.equal(isInside(root, file, flavour), inside, file);
  });
});
