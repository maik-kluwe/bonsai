import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import * as path from 'path';
import { isInside, preferredRepo, repoRelative, sameRepo } from '../paths';

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

describe('preferredRepo', () => {
  test('the open file decides, then the first workspace folder with a repository; otherwise there is no preference', () => {
    const roots = ['/w/second', '/w/app', '/w/app/lib'];
    const cases: [string | undefined, string[], string | undefined, string][] = [
      ['/w/app/src/x.ts', ['/w/second'], '/w/app', 'file wins over the folder'],
      ['/w/app/lib/y.ts', [], '/w/app/lib', 'the innermost repository'],
      ['/elsewhere/z.ts', ['/w/app', '/w/second'], '/w/app', 'a file outside every repository counts as none'],
      [undefined, ['/w/second', '/w/app'], '/w/second', 'order of the folders, not of the repositories'],
      [undefined, ['/nothing', '/w/app/src'], '/w/app', 'a folder inside a repository'],
      [undefined, ['/w'], '/w/second', 'a folder holding repositories: the first of them'],
      [undefined, ['/nothing'], undefined, 'no preference'],
      [undefined, [], undefined, 'no folder'],
    ];
    for (const [file, folders, want, why] of cases) assert.equal(preferredRepo(roots, file, folders, path.posix), want, why);
  });

  test('Windows: the case of drive and folders does not matter', () => {
    assert.equal(preferredRepo(['c:\\w\\App'], 'C:\\W\\app\\a.txt', [], path.win32), 'c:\\w\\App');
  });
});

describe('sameRepo', () => {
  test('two handles of one repository are the same, whatever object they are; nothing is the same as nothing', () => {
    const handle = (fsPath: string) => ({ rootUri: { fsPath } });
    assert.equal(sameRepo(handle('/r/a'), handle('/r/a')), true);
    assert.equal(sameRepo(handle('/r/a'), handle('/r/b')), false);
    assert.equal(sameRepo(undefined, undefined), false);
    assert.equal(sameRepo(handle('/r/a'), undefined), false);
  });
});
