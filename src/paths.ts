import * as nodePath from 'path';

/** Path relative to the repo root, always with "/" (as Git expects it, also on Windows). */
export function repoRelative(root: string, file: string, p: typeof nodePath = nodePath): string {
  return p.relative(root, file).split(p.sep).join('/');
}

/**
 * Whether two repository handles are the same repository. The Git extension may hand out a new object for the same
 * repository each time `repositories` is read, so `===` and `includes` cannot tell.
 */
export function sameRepo(a: { rootUri: { fsPath: string } } | undefined, b: { rootUri: { fsPath: string } } | undefined): boolean {
  return !!a && !!b && a.rootUri.fsPath === b.rootUri.fsPath;
}

/**
 * The repository to show first, of the roots `roots`: the one of the file in the active editor, else the one of the first
 * workspace folder that has one (the folder is the repository, lies in it, or holds it). Undefined if neither says anything.
 */
export function preferredRepo(roots: string[], file: string | undefined, folders: string[], p: typeof nodePath = nodePath): string | undefined {
  // The innermost one: a submodule or a nested repository wins over the repository around it
  const around = (path: string) => roots.filter(r => isInside(r, path, p)).sort((a, b) => b.length - a.length)[0];
  const ofFile = file === undefined ? undefined : around(file);
  if (ofFile !== undefined) return ofFile;
  for (const folder of folders) {
    const found = around(folder) ?? roots.find(r => isInside(folder, r, p));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Is `file` (absolute or relative to `root`) inside `root`? Protects against "../" paths from the webview. */
export function isInside(root: string, file: string, p: typeof nodePath = nodePath): boolean {
  const rel = p.relative(root, p.resolve(root, file));
  // "..file" is a valid name in the repo; only ".." as a whole segment leads outside
  return rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel);
}
