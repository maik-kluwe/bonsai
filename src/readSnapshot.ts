import { Status, type Change, type Repository } from './git';
import { parseDiff } from './diff';
import { findChange } from './flows';
import { diffPayload, type ToWebview } from './protocol';
import type { GitService } from './gitService';
import { isConflict, statusLetter, type ChangeItem } from './changes';
import { repoRelative } from './paths';
import { buildSnapshot, mergeInfo, type Snapshot } from './snapshot';
import { t } from './i18n';
import { readImages, type ImageSource } from './images';

/** The changes of VS Code's Git state as the view lists them: paths relative to the repository, sorted. */
export function changeItems(root: string, changes: readonly Change[]): ChangeItem[] {
  return changes.map(c => ({
    path: repoRelative(root, c.uri.fsPath),
    oldPath: c.renameUri ? repoRelative(root, c.originalUri.fsPath) : undefined,
    status: statusLetter(c.status),
    conflict: isConflict(c.status),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Everything the view shows, read from the repository now and without caches. The panel keeps its own caches around the
 * same steps; the scenario tests (src/test/scenario.ts) use this to answer the view as the panel would.
 */
export async function readSnapshot(svc: GitService, repo: Repository, limit: number): Promise<Snapshot> {
  const [refs, head, merge] = await Promise.all([svc.refs(), svc.head(), svc.mergeState()]);
  const commits = await svc.log(limit);
  const s = repo.state;
  const root = repo.rootUri.fsPath;
  const staged = changeItems(root, s.indexChanges);
  const unstaged = changeItems(root, [...s.mergeChanges, ...s.workingTreeChanges, ...s.untrackedChanges]);
  return buildSnapshot({
    commits, more: commits.length >= limit, refs, head, currentBranch: s.HEAD?.name, staged, unstaged,
    merge: mergeInfo(merge, s.mergeChanges.length, t('incomingSide')), remotes: s.remotes.map(r => r.name),
    worktreeSubject: n => t('worktreeRow', n), now: Date.now() / 1000,
  });
}

/** The diff of one local change as the view shows it: a diff, the two sides of a conflict, or a note that the file is gone. */
export async function readLocalDiff(svc: GitService, repo: Repository, rel: string, staged: boolean, context: number | undefined, mergeHash: string | undefined): Promise<ToWebview> {
  const c = findChange(repo, rel, staged);
  if (!c) return { type: 'diff', path: rel, staged, missing: true };
  if (isConflict(c.status)) return { type: 'diff', path: rel, staged, conflict: true, sides: await svc.conflictSides(rel, mergeHash) };
  const untracked = c.status === Status.UNTRACKED;
  const d = parseDiff(await svc.diffLocal(rel, staged, untracked, context));
  const before = c.renameUri ? repoRelative(repo.rootUri.fsPath, c.originalUri.fsPath) : rel;
  // Staged: HEAD against the index. Unstaged: the index against the file. Untracked: only the file.
  const left: ImageSource = untracked ? undefined : staged ? { kind: 'rev', rev: 'HEAD', file: before } : { kind: 'index', file: before };
  const right: ImageSource = staged ? { kind: 'index', file: rel } : { kind: 'workingTree', file: rel };
  const images = d.binary ? await readImages(svc, left, right) : undefined;
  return { type: 'diff', path: rel, staged, untracked, context, ...diffPayload(d, images) };
}
