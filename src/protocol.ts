import type { ActivityEntry } from './activityLog';
import type { ParsedDiff } from './diff';
import type { CommitDetails, ConflictSide, GitService, PullPreview } from './gitService';
import type { ImagePair } from './images';
import type { Snapshot } from './snapshot';

/**
 * Messages between the extension host and the webview (media/main.js). This file is the contract: the host
 * is type-checked against it, and protocol.test.ts checks that main.js sends and handles exactly these types.
 */

/** Webview -> host. */
export type ToHost =
  | { type: 'ready' }
  | { type: 'selectRepo'; root: string }
  | { type: 'refresh' }
  /** The list reached its end and the log may hold more commits. */
  | { type: 'loadMore' }
  /** The look of the diff toolbar, kept by the host so that it survives a reload. */
  | { type: 'saveLook'; look: LookState }
  | { type: 'action'; action: 'stash' | 'snapshot' | 'branch' }
  /** From one remote, or from all of them without `remote`; branches that are gone on the server are removed. */
  | { type: 'fetch'; remote?: string }
  /** The Pull button: the host fetches the upstream, then answers with `pullInfo` for the dialog. */
  | { type: 'pullPrepare' }
  /** The dialog's answer: merge or rebase the fetched upstream into the current branch, with local changes stashed and reapplied or not. */
  | { type: 'pull'; rebase: boolean; stash: boolean }
  | { type: 'push'; branch: string; remote: string; remoteBranch: string; track: boolean; tags: boolean; force: boolean }
  | { type: 'openUrl'; url: string }
  | { type: 'details'; hash: string; stash?: boolean }
  | { type: 'fileDiff'; hash: string; parent?: string; path: string; oldPath?: string; base?: string; target?: string; /** Lines of context around a change (git's -U); the default of 3 when absent */ context?: number; /** git's -w: whitespace differences do not count (read-only views only) */ ignoreSpace?: boolean }
  | { type: 'openDiff'; hash: string; parent?: string; path: string; oldPath?: string; status: string; base?: string; target?: string }
  | { type: 'checkout'; ref: string }
  | { type: 'createBranchAt'; hash: string }
  /** A local branch; the host asks, and offers to delete its remote branch along with it. */
  | { type: 'deleteBranch'; name: string }
  /** A remote branch such as origin/feat/x, on the server. */
  | { type: 'deleteRemoteBranch'; name: string }
  | { type: 'renameBranch'; name: string }
  /** Choose or remove the upstream of a local branch; the host offers the remote branches. */
  | { type: 'setTracking'; name: string }
  | { type: 'createTagAt'; hash: string }
  /** The host asks, and offers to delete the tag on a remote as well. */
  | { type: 'deleteTag'; name: string }
  /** The host asks to which remote. */
  | { type: 'pushTag'; name: string }
  /** Moves a local branch that is not checked out to its upstream; Git refuses anything but a fast-forward. */
  | { type: 'fastForward'; name: string }
  /** Fetches a remote branch, then merges it into the current branch with the usual dialog. */
  | { type: 'pullInto'; ref: string }
  | { type: 'copy'; text: string }
  | { type: 'stashAction'; action: 'apply' | 'drop' | 'rename'; index: number; name: string }
  | { type: 'stashFiles'; paths: string[]; message: string }
  | { type: 'stage' | 'unstage' | 'discard'; paths: string[] }
  | { type: 'openChange'; path: string; staged: boolean }
  | { type: 'openFile'; path: string }
  | { type: 'loadDiff'; path: string; staged: boolean; /** Lines of context (git's -U); the default of 3 when absent */ context?: number }
  /** `context` is the one the shown diff was made with; `index` and `hunk` count in that diff, so it is required. `expect` is the body of that hunk on screen (`hunkBody`): the host refuses when the hunk at that position says something else by now. */
  | { type: 'hunk'; path: string; staged: boolean; index: number; action: 'stage' | 'unstage' | 'discard'; context: number; expect: string[] }
  /** Single changed lines of one hunk; `lines` are indices into the hunk's lines. */
  | { type: 'lines'; path: string; staged: boolean; hunk: number; lines: number[]; action: 'stage' | 'unstage' | 'discard'; context: number; expect: string[] }
  | { type: 'resolveUsing'; side: 'ours' | 'theirs'; paths: string[] }
  | { type: 'mergeEditor'; path: string }
  | { type: 'mergeInputs'; path: string }
  | { type: 'mergeResolve'; path: string; content: string }
  | { type: 'mergeAbort' }
  /** Merge a branch name or commit hash into the current branch; the host asks for the options. */
  | { type: 'merge'; ref: string }
  | { type: 'cherryPick'; hash: string }
  | { type: 'revert'; hash: string }
  /** Move the current branch to a commit; the host asks for soft, mixed or hard. */
  | { type: 'reset'; hash: string }
  /** Replay the current branch onto a commit or branch; the host asks for the options. */
  | { type: 'rebase'; ref: string }
  /** Opens the dialog of an interactive rebase of the current branch, starting at this commit. */
  | { type: 'interactiveRebase'; hash: string }
  /** The same dialog for the commits of the current branch that `ref` does not have, replayed onto `ref`. */
  | { type: 'interactiveRebaseOnto'; ref: string }
  /** Opens a multi-file diff of a commit against the working tree. */
  | { type: 'compareLocal'; hash: string }
  | { type: 'copyCommitInfo'; hash: string }
  /** Asks where and writes the commit as a patch; `subject` proposes the file name. */
  | { type: 'savePatch'; hash: string; subject: string }
  | { type: 'rebaseContinue' }
  | { type: 'rebaseSkip' }
  | { type: 'commit'; message: string; amend: boolean }
  | { type: 'lastMessage' }
  | { type: 'recentMessages' }
  /** The activity popup was opened and wants the log. */
  | { type: 'activity' };

/** Parsed diff as the webview renders it. */
export interface DiffPayload {
  binary: boolean;
  hunks: { header: string; lines: ParsedDiff['hunks'][number]['lines'] }[];
  /** The two sides of a changed picture (png, jpg …); absent for other files */
  images?: ImagePair;
}

export const diffPayload = (d: ParsedDiff, images?: ImagePair): DiffPayload => ({
  binary: d.binary,
  hunks: d.hunks.map(h => ({ header: h.header, lines: h.lines })),
  ...(images && { images }),
});

/** Host -> webview. */
export type ToWebview =
  | Snapshot
  | { type: 'repos'; repos: { root: string; name: string }[]; selected?: string }
  | { type: 'details'; details: CommitDetails }
  /** Diff of one file of a commit, shown inline under the file in the details pane. */
  | ({ type: 'fileDiff'; hash: string; path: string; /** As asked for, so the view can tell the answer from an outdated one */ context?: number; ignoreSpace?: boolean } & DiffPayload)
  /** Diff of a local change, shown next to the lists. */
  | { type: 'diff'; path: string; staged: boolean; missing: true }
  | { type: 'diff'; path: string; staged: boolean; conflict: true; sides?: { ours: ConflictSide; theirs: ConflictSide } }
  | ({ type: 'diff'; path: string; staged: boolean; untracked: boolean; context?: number } & DiffPayload)
  | { type: 'mergeInputs'; path: string; result: Awaited<ReturnType<GitService['mergeInputs']>> }
  | { type: 'lastMessage'; message: string }
  | { type: 'recentMessages'; messages: string[] }
  | { type: 'committed' }
  /** The whole log, newest first; sent when asked for and after every new entry. */
  | { type: 'activity'; entries: readonly ActivityEntry[] }
  /** The saved look of the diff toolbar, sent once the view is ready. */
  | { type: 'look'; look: LookState | undefined }
  /** The repository changed, the lists did not: a file on them may have, so the diff on screen is read again. */
  | { type: 'recheck' }
  /** What the server said to a push (GitLab's link for a merge request). */
  | { type: 'pushResult'; output: string }
  /** What the pull dialog shows, once the upstream is fetched. */
  | { type: 'pullInfo'; info: PullInfo }
  /** An operation stopped on conflicts: which files, and what Git printed. */
  | { type: 'conflicts'; files: string[]; output: string }
  /** The sidebar marks the new branch once it is in the data. */
  | { type: 'branchCreated'; name: string }
  | { type: 'error'; message: string };

/** What the pull dialog needs: the branches, what the local changes would meet, and whether the user's Git setting is to rebase. */
export interface PullInfo extends PullPreview {
  /** A remote branch such as origin/main. */
  upstream: string;
  /** The checked-out branch. */
  into: string;
  /** What the Git settings say; the dialog starts with this when the user has not chosen yet. */
  rebase: boolean;
  /** What the user ticked the last time they pulled. */
  last?: PullChoice;
}

/** The two boxes of the pull dialog. */
export interface PullChoice { rebase: boolean; stash: boolean }

/** What a stored choice may hold: two booleans, or nothing. */
export function sanitizePullChoice(v: unknown): PullChoice | undefined {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return typeof o.rebase === 'boolean' && typeof o.stash === 'boolean' ? { rebase: o.rebase, stash: o.stash } : undefined;
}

/** Look of the diff toolbar: show spaces, show line endings, wrap lines, ignore whitespace, lines of context (null = the whole file). */
export interface LookState { ws: boolean; eol: boolean; wrap: boolean; iws: boolean; ctx: number | null }

/** What a stored or received look may hold: booleans, and a whole number of context lines or null; anything else falls back. */
export function sanitizeLook(v: unknown): LookState {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const ctx = o.ctx === null ? null : typeof o.ctx === 'number' && Number.isInteger(o.ctx) && o.ctx >= 0 ? Math.min(o.ctx, 100000) : 3;
  return { ws: o.ws === true, eol: o.eol === true, wrap: o.wrap === true, iws: o.iws === true, ctx };
}

/** Runtime lists of the message types; `satisfies` makes the compiler fail when a union member is missing here. */
export const TO_HOST_TYPES = Object.keys({
  ready: 0, selectRepo: 0, refresh: 0, loadMore: 0, saveLook: 0, action: 0, fetch: 0, pullPrepare: 0, pull: 0, push: 0, openUrl: 0, details: 0, fileDiff: 0, openDiff: 0, checkout: 0, createBranchAt: 0, deleteBranch: 0, deleteRemoteBranch: 0, renameBranch: 0, setTracking: 0, createTagAt: 0, deleteTag: 0, pushTag: 0, fastForward: 0, pullInto: 0,
  copy: 0, stashAction: 0, stashFiles: 0, stage: 0, unstage: 0, discard: 0, openChange: 0, openFile: 0, loadDiff: 0, hunk: 0, lines: 0,
  resolveUsing: 0, mergeEditor: 0, mergeInputs: 0, mergeResolve: 0, mergeAbort: 0, merge: 0, cherryPick: 0, revert: 0, reset: 0, rebase: 0, interactiveRebase: 0, interactiveRebaseOnto: 0, compareLocal: 0, copyCommitInfo: 0, savePatch: 0, rebaseContinue: 0, rebaseSkip: 0, commit: 0, lastMessage: 0, recentMessages: 0, activity: 0,
} satisfies Record<ToHost['type'], 0>);

export const TO_WEBVIEW_TYPES = Object.keys({
  data: 0, repos: 0, pushResult: 0, pullInfo: 0, conflicts: 0, branchCreated: 0, details: 0, fileDiff: 0, diff: 0, mergeInputs: 0, lastMessage: 0, recentMessages: 0, committed: 0, activity: 0, look: 0, recheck: 0, error: 0,
} satisfies Record<ToWebview['type'], 0>);

/** Cheap shape check for messages arriving from the webview: an object with a known `type`. Fields are not validated. */
export const isToHost = (m: unknown): m is ToHost =>
  typeof m === 'object' && m !== null && TO_HOST_TYPES.includes((m as { type?: string }).type as string);
