import { stashLabel } from './changes';
import type { CommitInfo, FileChange, RefInfo } from './gitService';

/** Field and record separators in the `--format` strings below. */
export const US = '\x1f';
export const RS = '\x1e';

export const LOG_FORMAT = `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%s${RS}`;
export const REF_FORMAT = `--format=%(refname)${US}%(objectname)${US}%(*objectname)${US}%(upstream:short)${US}%(upstream:track,nobracket)`;
export const STASH_FORMAT = `--format=%gd${US}%H${US}%gs${US}%P${US}%ct${US}%an${US}%ae`;
export const DETAILS_FORMAT = `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%cn${US}%ct${US}%s${US}%b`;

/** Output of `git log` with LOG_FORMAT. */
export function parseLog(out: string): CommitInfo[] {
  return out.split(RS).map(r => r.trim()).filter(Boolean).map(r => {
    const [hash, parents, author, email, date, subject] = r.split(US);
    return { hash, parents: parents ? parents.split(' ') : [], author, email, date: Number(date), subject };
  });
}

/** Output of `git for-each-ref` with REF_FORMAT over heads, remotes and tags. */
export function parseRefs(out: string): RefInfo[] {
  const refs: RefInfo[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [full, obj, peeled, upstream, track] = line.split(US);
    if (full.endsWith('/HEAD')) continue; // hide origin/HEAD
    if (full.startsWith('refs/heads/')) {
      const ahead = /ahead (\d+)/.exec(track)?.[1];
      const behind = /behind (\d+)/.exec(track)?.[1];
      refs.push({
        name: full.slice(11), kind: 'head', hash: obj, upstream: upstream || undefined,
        ahead: ahead ? Number(ahead) : 0, behind: behind ? Number(behind) : 0, gone: track === 'gone',
      });
    } else if (full.startsWith('refs/remotes/')) {
      refs.push({ name: full.slice(13), kind: 'remote', hash: obj });
    } else if (full.startsWith('refs/tags/')) {
      refs.push({ name: full.slice(10), kind: 'tag', hash: peeled || obj });
    }
  }
  return refs;
}

/** Output of `git stash list` with STASH_FORMAT. */
export function parseStashList(out: string): RefInfo[] {
  const refs: RefInfo[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ref, hash, subject, parents, date, author, email] = line.split(US);
    const index = Number(/\{(\d+)\}/.exec(ref)?.[1] ?? 0);
    refs.push({ name: subject, label: stashLabel(subject), kind: 'stash', hash, index, parent: parents.split(' ')[0], date: Number(date), author, email });
  }
  return refs;
}

/** Output of `git diff --name-status -z -M` (or `diff-tree`, same shape). */
export function parseNameStatus(out: string): FileChange[] {
  const raw = out.split('\0').filter(s => s !== '');
  const files: FileChange[] = [];
  for (let i = 0; i < raw.length;) {
    const status = raw[i++];
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push({ status: status[0], oldPath: raw[i++], path: raw[i++] });
    } else {
      files.push({ status: status[0], path: raw[i++] });
    }
  }
  return files;
}

/** Output of `git show -s` with DETAILS_FORMAT: everything of CommitDetails except the files. */
export function parseCommitMeta(out: string) {
  const [hash, parents, author, email, date, committer, cdate, subject, body] = out.split(US);
  return {
    hash, parents: parents ? parents.split(' ') : [], author, email, date: Number(date),
    committer, committerDate: Number(cdate), subject, body: (body ?? '').trim(),
  };
}
