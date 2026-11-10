/**
 * Merge, cherry-pick and revert as plain data: which Git arguments an option set produces, how a dry run
 * ("merge-tree") is read, and when an operation must not start. No Git calls and no VS Code here.
 */

export type OperationKind = 'merge' | 'cherryPick' | 'revert';

/** Merge options as offered by the dialog (same set as Fork). */
export type MergeOption = 'default' | 'noFf' | 'squash' | 'noCommit';

export const MERGE_OPTIONS: readonly MergeOption[] = ['default', 'noFf', 'squash', 'noCommit'];

const MERGE_FLAG: Record<MergeOption, string[]> = {
  default: ['--no-edit'],
  noFf: ['--no-ff', '--no-edit'],
  squash: ['--squash'],
  noCommit: ['--no-commit'],
};

/** Everything Bonsai can show as "in progress": the three dry-runnable operations plus a rebase. */
export type StateKind = OperationKind | 'rebase';

/** `git rebase [--autostash] <onto>`: replays the current branch on top of `onto`. */
export const rebaseArgs = (onto: string, o: { autostash: boolean }): string[] =>
  ['rebase', ...(o.autostash ? ['--autostash'] : []), onto];

/** How far `git reset` reaches: HEAD only, HEAD and index, or HEAD, index and working tree. */
export type ResetMode = 'soft' | 'mixed' | 'hard';

/** In the order of the dialog; mixed is Git's default and Fork's. */
export interface PushOptions {
  branch: string;
  remote: string;
  remoteBranch: string;
  track: boolean;
  tags: boolean;
  force: boolean;
}

/** Full ref names on both sides: a tag named like the branch would make the short form ambiguous. */
export const pushArgs = (o: PushOptions): string[] => [
  'push', ...(o.track ? ['-u'] : []), ...(o.tags ? ['--tags'] : []), ...(o.force ? ['--force-with-lease'] : []),
  o.remote, `refs/heads/${o.branch}:refs/heads/${o.remoteBranch}`,
];

/** What `git push` printed, if the server had something to say (GitLab's link for a merge request); otherwise empty. */
export function remoteMessages(output: string): string {
  const said = output.split('\n').some(l => /^remote:\s*\S/.test(l));
  return said ? output.trim() : '';
}

/**
 * Whether this push created `remoteBranch` on the server: Git marks new refs with a `*`, whatever the language of the
 * text behind it (`[new branch]` is translated). A new tag of the same name would count, too.
 */
export const createdRemoteBranch = (output: string, remoteBranch: string): boolean =>
  output.split(/\r?\n/).some(l => l.startsWith(' * ') && l.endsWith(` -> ${remoteBranch}`));

/** Git could not sign in by itself. VS Code's Git extension can ask the user; a rejected push it could not do better. */
export const isAuthFailure = (message: string): boolean =>
  /could not read (Username|Password)|terminal prompts disabled|Authentication failed|Permission denied|Host key verification failed|Could not read from remote repository/i.test(message);

/**
 * Why a call into the Git extension failed. Its errors always read "Failed to execute git" and keep what Git printed in
 * `stderr` (or `stdout`, where Git reports conflicts). The reason is at the end; progress lines in front of it are
 * dropped when there are many.
 */
export function apiErrorMessage(e: unknown, maxLines = 10): string {
  const { stderr, stdout, message } = (typeof e === 'object' && e !== null ? e : {}) as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const printed = [stderr, stdout].find((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (printed === undefined) return String(message ?? e);
  const lines = printed.trim().split(/\r?\n/);
  return lines.slice(-maxLines).join('\n');
}

export const RESET_MODES: readonly ResetMode[] = ['mixed', 'soft', 'hard'];

/** `git reset --<mode> <hash>`. */
export const resetArgs = (hash: string, mode: ResetMode): string[] => ['reset', `--${mode}`, hash];

/** `git merge [option] <ref>`. */
export const mergeArgs = (ref: string, option: MergeOption): string[] => ['merge', ...MERGE_FLAG[option], ref];

/** `git cherry-pick [-n] [-x] <hash>`: without `commit` the changes are only applied to index and working tree. */
export const cherryPickArgs = (hash: string, o: { commit: boolean; appendOrigin: boolean }): string[] =>
  ['cherry-pick', ...(o.commit ? [] : ['-n']), ...(o.appendOrigin ? ['-x'] : []), hash];

/** `git revert --no-edit [--no-commit] <hash>`. */
export const revertArgs = (hash: string, o: { commit: boolean }): string[] =>
  ['revert', '--no-edit', ...(o.commit ? [] : ['--no-commit']), hash];

/**
 * Dry run of the operation on HEAD without touching index or working tree. A cherry-pick is a three-way merge
 * with the commit's parent as base; a revert is the same with base and tip swapped. Only single-parent commits
 * have a defined base, so `hash^` is used.
 */
export const previewArgs = (kind: OperationKind, hash: string): string[] => {
  const base = ['merge-tree', '--write-tree', '--name-only', '--no-messages'];
  switch (kind) {
    case 'merge': return [...base, 'HEAD', hash];
    case 'cherryPick': return [...base, `--merge-base=${hash}^`, 'HEAD', hash];
    case 'revert': return [...base, `--merge-base=${hash}`, 'HEAD', `${hash}^`];
  }
};

/** Output of `merge-tree --write-tree --name-only --no-messages`: tree id, then the conflicted paths (if any). */
export const parsePreview = (stdout: string): string[] => {
  const [, ...paths] = stdout.split('\n').map(l => l.trim());
  return [...new Set(paths.filter(Boolean))];
};

/** What the user picked: the merge option, or for cherry-pick and revert whether the result is committed. */
export type Choice = { kind: 'merge'; option: MergeOption } | { kind: 'cherryPick' | 'revert'; commit: boolean };

/**
 * Whether the operation must not start although the dry run found conflicts.
 * With conflicts, Git leaves MERGE_HEAD, CHERRY_PICK_HEAD or REVERT_HEAD behind, so Bonsai can show the state and
 * abort it. Two variants leave no such marker and would strand the user in a state Bonsai cannot leave:
 * a squash merge and a cherry-pick with -n. (A revert with --no-commit does keep REVERT_HEAD.)
 */
export const unsupportedWithConflicts = (choice: Choice, conflicts: string[]): boolean =>
  conflicts.length > 0 && (choice.kind === 'merge' ? choice.option === 'squash' : choice.kind === 'cherryPick' && !choice.commit);

/** Todo commands that replay a commit (long and short forms, `fixup -C` and friends included). */
const REPLAYS = /^(pick|p|reword|r|edit|e|squash|s|fixup|f)(\s|$)/;

/**
 * Where a rebase stands, counted in commits that are replayed: from the commands already done (the one that stopped is
 * the last of them) and those still to do. Drops, execs, labels and comments are not steps, so "commit 2 of 3" means
 * the second of three commits, not the second of three todo lines.
 */
export function replaySteps(done: string, todo: string): { step: number; total: number } {
  const count = (text: string) => text.split('\n').filter(l => REPLAYS.test(l.trim())).length;
  const step = count(done);
  return { step, total: step + count(todo) };
}

/** One staged change as `git diff --cached --raw` reports it. */
export interface StagedEntry {
  status: string;
  mode: string;
  /** Blob in the index (all zeros for a deletion). */
  oid: string;
  /** Blob in HEAD (all zeros for a new file). */
  oldOid: string;
  path: string;
}

/** Output of `git diff --cached --raw -z --no-renames`. */
export function parseStagedRaw(out: string): StagedEntry[] {
  const parts = out.split('\0');
  const entries: StagedEntry[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/.exec(parts[i]);
    if (m) entries.push({ status: m[5], mode: m[2], oldOid: m[3], oid: m[4], path: parts[i + 1] });
  }
  return entries;
}

/**
 * Input for `git update-index -z --index-info` that stages again what was staged before a rebase with autostash (Git
 * brings the stash back unstaged). A path is only restored if the rebase left its file in HEAD as it was: otherwise the
 * old staged version would also undo what the rebase brought in. `headBlobs` holds the blob in HEAD now, by path.
 */
export function restoreIndexInfo(entries: StagedEntry[], headBlobs: Map<string, string>): string {
  const isZero = (oid: string) => /^0+$/.test(oid);
  return entries
    .filter(e => (isZero(e.oldOid) ? !headBlobs.has(e.path) : headBlobs.get(e.path) === e.oldOid))
    .map(e => (e.status === 'D' ? `0 ${e.oid}\t${e.path}\0` : `${e.mode} ${e.oid}\t${e.path}\0`))
    .join('');
}
