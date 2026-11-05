import { Status } from './git';

/** Hash of the empty Git tree – placeholder ref for "file did not exist". */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * One side of a diff: a file at a ref. `ref` '' is the index, no `ref` is the file in the working tree.
 * `file` says which path: the current one, or the one before a rename.
 */
export interface DiffSide { file: 'current' | 'original'; ref?: string }

/** Refs of the two sides of a file in a commit or between two refs. Added files have nothing on the left, deleted ones nothing on the right. */
export function commitDiffRefs(m: { hash: string; parent?: string; base?: string; target?: string; status?: string }): { left: string; right: string } {
  return {
    left: m.status === 'A' ? EMPTY_TREE : m.base ?? m.parent ?? EMPTY_TREE,
    right: m.status === 'D' ? EMPTY_TREE : m.target ?? m.hash,
  };
}

/** The sides of a file in the comparison of a commit with the working tree; no `ref` is the working tree. */
export const compareRefs = (hash: string, status: string): { left: string; right?: string } => ({
  left: status === 'A' ? EMPTY_TREE : hash,
  right: status === 'D' ? EMPTY_TREE : undefined,
});

/** How a local change is shown: its two sides and the key of the title, or just open the file (conflicts). */
export type ChangeView = { left: DiffSide; right: DiffSide; title: 'diffStaged' | 'diffWorking' | 'diffDeleted' | 'diffNew' } | { open: true };

/** Staged = HEAD ↔ index, unstaged = index ↔ working copy. */
export function changeView(status: Status, staged: boolean): ChangeView {
  if (staged) {
    return {
      left: status === Status.INDEX_ADDED ? { file: 'current', ref: EMPTY_TREE } : { file: 'original', ref: 'HEAD' },
      right: status === Status.INDEX_DELETED ? { file: 'current', ref: EMPTY_TREE } : { file: 'current', ref: '' },
      title: 'diffStaged',
    };
  }
  switch (status) {
    case Status.MODIFIED:
    case Status.TYPE_CHANGED:
      return { left: { file: 'current', ref: '~' }, right: { file: 'current' }, title: 'diffWorking' };
    case Status.DELETED:
      return { left: { file: 'current', ref: '~' }, right: { file: 'current', ref: EMPTY_TREE }, title: 'diffDeleted' };
    case Status.UNTRACKED:
    case Status.INTENT_TO_ADD:
      return { left: { file: 'current', ref: EMPTY_TREE }, right: { file: 'current' }, title: 'diffNew' };
    default:
      return { open: true };
  }
}
