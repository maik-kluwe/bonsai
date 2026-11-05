import { countFiles, type ChangeItem } from './changes';
import { withStashes, type CommitInfo, type MergeState, type RebaseProgress, type RefInfo } from './gitService';
import { computeGraph, visibleRows, type GraphRow } from './graph';
import type { StateKind } from './operations';

/** Pseudo hash of the "Local changes" row in the graph. */
export const WORKTREE = 'WORKTREE';

/**
 * Merge, cherry-pick, revert or rebase in progress, or unresolved conflicts that Git left without any marker
 * ('conflicts': stash apply or pop, checkout -m), as the webview needs it (banner, commit message, conflict cards).
 */
export interface MergeInfo {
  kind: StateKind | 'conflicts';
  rebase?: RebaseProgress;
  theirs: string;
  hash: string;
  message: string;
  conflicts: number;
}

/** `incoming` names the other side when there is no operation to take it from. */
export const mergeInfo = (merge: MergeState | undefined, conflicts: number, incoming: string): MergeInfo | undefined =>
  !merge ? (conflicts > 0 ? { kind: 'conflicts', theirs: incoming, hash: '', message: '', conflicts } : undefined) : { kind: merge.kind, ...(merge.rebase && { rebase: merge.rebase }), theirs: merge.theirs, hash: merge.hash, message: merge.message, conflicts };

/** Data packet for the webview. */
export interface Snapshot {
  type: 'data';
  commits: CommitInfo[];
  /** The log hit its limit, so older commits probably exist. */
  more: boolean;
  rows: GraphRow[];
  refs: RefInfo[];
  maxWidth: number;
  head?: string;
  currentBranch?: string;
  staged: ChangeItem[];
  unstaged: ChangeItem[];
  /** Changed files (partially staged count once). */
  changeCount: number;
  merge?: MergeInfo;
  /** Names of the remotes, also those without a branch yet. */
  remotes?: string[];
  /** Gravatar hashes by author email, only if the user opted in (`bonsai.gravatar`); see src/avatars.ts. */
  avatars?: Record<string, string>;
}

export interface SnapshotInput {
  /** Log without stashes (`GitService.log`). */
  commits: CommitInfo[];
  /** Whether the log was cut at its limit. */
  more?: boolean;
  refs: RefInfo[];
  head?: string;
  currentBranch?: string;
  staged: ChangeItem[];
  unstaged: ChangeItem[];
  merge?: MergeInfo;
  remotes?: string[];
  /** Text of the "Local changes" row for this file count (comes from i18n). */
  worktreeSubject(files: number): string;
  /** Timestamp of the "Local changes" row in seconds. */
  now: number;
}

/**
 * Data packet from log, refs and status list: stashes via their base commit, "Local changes" as a pseudo commit above HEAD,
 * compute the graph and cut it to the visible lanes.
 */
export function buildSnapshot(i: SnapshotInput): Snapshot {
  const changeCount = countFiles(i.staged, i.unstaged);
  const logged = withStashes(i.commits, i.refs);
  const commits: CommitInfo[] = changeCount && i.head
    ? [{ hash: WORKTREE, parents: [i.head], author: '', email: '', date: i.now, subject: i.worktreeSubject(changeCount) }, ...logged]
    : logged;
  const { rows, maxWidth } = computeGraph(commits);
  return {
    type: 'data', commits, more: !!i.more, rows: visibleRows(rows), refs: i.refs, maxWidth, head: i.head,
    currentBranch: i.currentBranch, staged: i.staged, unstaged: i.unstaged, changeCount, merge: i.merge, remotes: i.remotes,
  };
}

/**
 * Fingerprint of what the webview shows. Status events fire on every save; if the fingerprint
 * stayed the same, neither the graph needs computing nor anything sending. `logKey` combines log boundary, HEAD and refs.
 */
export const snapshotSignature = (logKey: string, currentBranch: string | undefined, staged: ChangeItem[], unstaged: ChangeItem[], merge: MergeInfo | undefined): string =>
  JSON.stringify([logKey, currentBranch, staged, unstaged, merge]);
