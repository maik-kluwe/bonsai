import * as nodePath from 'path';

/** Path relative to the repo root, always with "/" (as Git expects it, also on Windows). */
export function repoRelative(root: string, file: string, p: typeof nodePath = nodePath): string {
  return p.relative(root, file).split(p.sep).join('/');
}

/** Is `file` (absolute or relative to `root`) inside `root`? Protects against "../" paths from the webview. */
export function isInside(root: string, file: string, p: typeof nodePath = nodePath): boolean {
  const rel = p.relative(root, p.resolve(root, file));
  // "..file" is a valid name in the repo; only ".." as a whole segment leads outside
  return rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel);
}
