import { Status } from './git';

/** A file in the "Local changes" list. The host decides what counts as a conflict; the webview only reads `conflict`. */
export interface ChangeItem {
  path: string;
  oldPath?: string;
  /** Display letter (M, A, D, R, C, U, I, T); for conflicts '!' */
  status: string;
  conflict: boolean;
}

const STATUS_LETTER: Record<number, string> = {
  [Status.INDEX_MODIFIED]: 'M', [Status.INDEX_ADDED]: 'A', [Status.INDEX_DELETED]: 'D',
  [Status.INDEX_RENAMED]: 'R', [Status.INDEX_COPIED]: 'C', [Status.MODIFIED]: 'M',
  [Status.DELETED]: 'D', [Status.UNTRACKED]: 'U', [Status.IGNORED]: 'I',
  [Status.INTENT_TO_ADD]: 'A', [Status.INTENT_TO_RENAME]: 'R', [Status.TYPE_CHANGED]: 'T',
};

/** Everything without its own letter (BOTH_MODIFIED, DELETED_BY_US …) is a merge conflict. */
export const isConflict = (s: Status): boolean => !(s in STATUS_LETTER);

export const statusLetter = (s: Status): string => STATUS_LETTER[s] ?? '!';

/** Stash name without the Git prefix: "On main: msg" and "WIP on main: msg" → "msg". The full name stays in the tooltip. */
export const stashLabel = (name: string): string => name.replace(/^(WIP )?[Oo]n [^:]+: /, '');

/** Count files, not entries: partially staged files appear in both lists. */
export const countFiles = (...lists: { path: string }[][]): number => new Set(lists.flat().map(f => f.path)).size;
