import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TextDecoder } from 'util';
import { GitRunner, type Trace } from './gitRunner';
import {
  DETAILS_FORMAT, LOG_FORMAT, REF_FORMAT, RS, STASH_FORMAT, US,
  parseCommitMeta, parseLog, parseNameStatus, parseRefs, parseStashList,
} from './gitParse';
import {
  cherryPickArgs, mergeArgs, parsePreview, previewArgs, parseStagedRaw, rebaseArgs, replaySteps, resetArgs, restoreIndexInfo, revertArgs,
  type MergeOption, type OperationKind, type ResetMode, type StagedEntry, type StateKind,
  pushArgs, type PushOptions,
} from './operations';
import type { Repository } from './git';
import { LABEL_BASE, LABEL_OURS, LABEL_THEIRS, parseMergeFile, type ParsedMerge } from './merge';
import { isInside } from './paths';

// The plan of an interactive rebase is shared with the dialog (media/rebaseplan.js)
const { build: buildRebasePlan } = require('../media/rebaseplan.js') as {
  build(entries: PlanEntry[], messagePath: (n: number) => string): { todo: string; messages: string[] };
};

export interface CommitInfo {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number; // Unix seconds
  subject: string;
  /** Only for stash rows in the graph: n in stash@{n}. */
  stash?: number;
}

export type RefKind = 'head' | 'remote' | 'tag' | 'stash';

export interface RefInfo {
  name: string;      // short name, e.g. "main", "origin/main", "v1.0"
  /** Only for stashes: name without the Git prefix ("On main: " or "WIP on main: "), for the sidebar and renaming. */
  label?: string;
  kind: RefKind;
  hash: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** The upstream is still configured, but its branch no longer exists on the remote. */
  gone?: boolean;
  /** Only for stashes: n in stash@{n}. */
  index?: number;
  /** Only for stashes: base commit (1st parent) and metadata for the row in the graph. */
  parent?: string;
  date?: number;
  author?: string;
  email?: string;
}

export interface FileChange {
  status: string; // A, M, D, R, C …
  path: string;
  oldPath?: string;
  /** Alternative comparison refs (e.g. untracked files in the 3rd stash parent). Default: 1st parent ↔ commit. */
  base?: string;
  target?: string;
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Result of an operation that may stop on conflicts; `output` is what Git printed (stdout, then stderr). */
export type Outcome = { conflicted: false } | { conflicted: true; output: string };

/** Everything Git printed before failing; `run` attaches both streams to its errors. */
export const gitOutput = (e: unknown): string => {
  const { stdout, stderr } = e as { stdout?: string; stderr?: string };
  return [stdout, stderr].map(s => (s ?? '').trim()).filter(Boolean).join('\n') || String((e as Error)?.message ?? e);
};

/** Marker ref that Git leaves while each operation waits for conflicts to be resolved. */
const MARKERS: [StateKind, string][] = [
  ['merge', 'MERGE_HEAD'], ['cherryPick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD'], ['rebase', 'REBASE_HEAD'],
];

/** A commit in the range of an interactive rebase. */
export interface RebaseCommit {
  hash: string;
  subject: string;
  /** Full message, subject and body. */
  message: string;
}

/** A commit with the action chosen for it (media/rebaseplan.js). */
export interface PlanEntry extends RebaseCommit {
  action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';
  /** The new message the user wrote, where one is needed. */
  edited?: string;
}

/** Where a rebase stands: the branch being rebased and which of its commits is being replayed. */
export interface RebaseProgress {
  branch: string;
  step: number;
  total: number;
}

/** Merge, cherry-pick, revert or rebase in progress (its marker ref is present). */
export interface MergeState {
  kind: StateKind;
  /** Set for a rebase. */
  rebase?: RebaseProgress;
  /** Name of the merged side (branch/tag) or abbreviated hash; always the abbreviated hash for cherry-pick and revert. */
  theirs: string;
  hash: string;
  /** MERGE_MSG without "#" comment lines. */
  message: string;
}

/** One side of a conflict: what it did to the file relative to the common base. */
export interface ConflictSide {
  change: 'modified' | 'added' | 'deleted';
  hash?: string;
  subject?: string;
  date?: number;
}

/**
 * Inserts stashes as rows with a single parent (the base commit) directly above it.
 * This keeps the stash's index and untracked helper commits out of the graph.
 * Stashes whose base is not in the loaded log are dropped.
 */
export function withStashes(commits: CommitInfo[], refs: RefInfo[]): CommitInfo[] {
  const byBase = new Map<string, CommitInfo[]>();
  for (const r of refs) {
    if (r.kind !== 'stash' || !r.parent) continue;
    const row: CommitInfo = {
      hash: r.hash, parents: [r.parent], author: r.author ?? '', email: r.email ?? '',
      date: r.date ?? 0, subject: r.name, stash: r.index,
    };
    byBase.set(r.parent, [...(byBase.get(r.parent) ?? []), row]);
  }
  if (!byBase.size) return commits;
  return commits.flatMap(c => [...(byBase.get(c.hash)?.sort((a, b) => a.stash! - b.stash!) ?? []), c]);
}

export interface CommitDetails extends CommitInfo {
  body: string;
  committer: string;
  committerDate: number;
  files: FileChange[];
}

/** git's -U<n> for a number of context lines; nothing (git's default of 3) when the number is not a whole count. */
const unifiedArg = (context?: number): string[] => (context !== undefined && Number.isInteger(context) && context >= 0 ? [`-U${context}`] : []);

export class GitService {
  private readonly git: GitRunner;

  /** @param trace called after every Git command with what it printed (the activity log picks the ones that change something) */
  constructor(gitPath: string, private readonly repo: Repository, trace?: Trace) {
    this.git = new GitRunner(gitPath, repo.rootUri.fsPath, trace);
  }

  get root(): string {
    return this.git.root;
  }

  /** See GitRunner.run. */
  run(args: string[], stdin?: string, okCodes: number[] = [], env?: NodeJS.ProcessEnv): Promise<string> {
    return this.git.run(args, stdin, okCodes, env);
  }

  /**
   * Pushes through the CLI, unlike the rest of the toolbar: the Git extension's push does not say what the server
   * answered. No prompt: nobody could answer it here, and the command would hang.
   * @returns what Git printed
   */
  async push(o: PushOptions): Promise<string> {
    const { stdout, stderr } = await this.git.runOutput(pushArgs(o), undefined, [], { GIT_TERMINAL_PROMPT: '0' });
    return stderr + stdout;
  }

  /** Diff of a local change: staged = HEAD ↔ index, otherwise index ↔ working copy. */
  diffLocal(path: string, staged: boolean, untracked: boolean, context?: number): Promise<string> {
    const unified = unifiedArg(context);
    if (untracked) return this.run(['diff', '--no-color', '--no-index', ...unified, '--', '/dev/null', path], undefined, [1]);
    return this.run(['diff', '--no-color', '--no-ext-diff', ...unified, ...(staged ? ['--cached'] : []), '--', path]);
  }

  /** Diff of a file between two refs (commit, stash, empty tree). */
  diffRefs(base: string, target: string, path: string, oldPath?: string, context?: number, ignoreSpace?: boolean): Promise<string> {
    return this.run(['diff', '--no-color', '--no-ext-diff', '-M', ...unifiedArg(context), ...(ignoreSpace ? ['-w'] : []), base, target, '--', ...(oldPath ? [oldPath] : []), path]);
  }

  /** Apply a patch to the index (cached) or the working copy, optionally in reverse. */
  async apply(patch: string, opts: { cached: boolean; reverse: boolean; recount?: boolean }): Promise<void> {
    await this.run(['apply', ...(opts.cached ? ['--cached'] : []), ...(opts.reverse ? ['-R'] : []), ...(opts.recount ? ['--recount'] : []), '--unidiff-zero', '-'], patch);
  }

  async log(max: number): Promise<CommitInfo[]> {
    return parseLog(await this.run(['log', '--exclude=refs/stash', '--all', '--date-order', `-n${max}`, LOG_FORMAT]));
  }

  async refs(): Promise<RefInfo[]> {
    const refs = parseRefs(await this.run(['for-each-ref', REF_FORMAT, 'refs/heads', 'refs/remotes', 'refs/tags']));
    try {
      refs.push(...parseStashList(await this.run(['stash', 'list', STASH_FORMAT])));
    } catch { /* no stashes */ }
    return refs;
  }

  /**
   * Git has no "stash rename". Stashes 0..index are dropped and saved again in reverse
   * order so the position is preserved. If a step fails, the
   * original state is restored from the remembered hashes so no stash is lost.
   */
  async renameStash(index: number, message: string): Promise<void> {
    const original: { hash: string; msg: string }[] = [];
    for (let i = 0; i <= index; i++) {
      const out = await this.run(['log', '-g', '-1', `--skip=${i}`, `--format=%H${US}%gs`, 'refs/stash']);
      const [hash, msg] = out.trim().split(US);
      original.push({ hash, msg });
    }
    const renamed = original.map((e, i) => i === index ? { ...e, msg: message } : e);
    const store = (e: { hash: string; msg: string }) => this.run(['stash', 'store', '-m', e.msg, e.hash]);
    let dropped = 0, stored = 0;
    try {
      for (let i = 0; i <= index; i++) { await this.run(['stash', 'drop', 'stash@{0}']); dropped++; }
      for (let i = index; i >= 0; i--) { await store(renamed[i]); stored++; }
    } catch (e) {
      // Whatever was already re-saved is on top and gets removed; then the dropped originals come back.
      for (let i = 0; i < stored; i++) await this.run(['stash', 'drop', 'stash@{0}']);
      for (let i = dropped - 1; i >= 0; i--) await store(original[i]);
      throw e;
    }
  }

  /**
   * Recent commit messages for the picker in the commit box (no merges, duplicates removed).
   * Prefers own commits (user.email), otherwise all on HEAD.
   */
  async recentMessages(max: number): Promise<string[]> {
    const read = async (author?: string) => {
      try {
        const out = await this.run(['log', '--no-merges', `-n${max * 2}`, `--format=%B${RS}`, ...(author ? [`--author=${author}`] : []), 'HEAD']);
        return out.split(RS).map(m => m.trim()).filter(Boolean);
      } catch { return []; }
    };
    let email = '';
    try { email = (await this.run(['config', 'user.email'])).trim(); } catch { /* not set */ }
    const msgs = (email && (await read(email)).length) ? await read(email) : await read();
    return [...new Set(msgs)].slice(0, max);
  }

  /**
   * Stashes only these files, staged and unstaged changes alike; everything else stays as it is. `-u` keeps new files
   * untracked. Git refuses a path that is gone from the index, and with `-u` it fails only after saving the stash, so
   * staged deletions (also the old side of a rename) are unstaged first; they come back from the stash as plain deletions.
   */
  async stashFiles(paths: string[], message: string): Promise<void> {
    if (!paths.length) return; // without paths Git would stash everything
    const literal = (...args: string[]) => this.run(['--literal-pathspecs', ...args, '--', ...paths]);
    const out = await literal('diff', '--cached', '--name-only', '--no-renames', '--diff-filter=D', '-z');
    const deleted = out.split('\0').filter(Boolean);
    if (deleted.length) await this.run(['--literal-pathspecs', 'reset', '-q', '--', ...deleted]);
    try {
      await literal('stash', 'push', '-u', ...(message ? ['-m', message] : []));
    } catch (e) {
      if (deleted.length) await this.run(['--literal-pathspecs', 'rm', '-q', '--cached', '--', ...deleted]);
      throw e;
    }
  }

  /**
   * Applies a stash and keeps it. Conflicts are a result, not an error: Git leaves the files unmerged without any
   * marker, which Bonsai shows as the generic 'conflicts' state.
   */
  applyStash(index: number): Promise<Outcome> {
    return this.attempt(['stash', 'apply', `stash@{${index}}`]);
  }

  /** Apply a stash and restore the index (staged stays staged). */
  async applyStashWithIndex(index: number): Promise<void> {
    await this.run(['stash', 'apply', '--index', `stash@{${index}}`]);
  }

  /** Conflicting paths a merge/cherry-pick/revert on HEAD would produce; empty = clean. Touches neither index nor working tree. */
  async preview(kind: OperationKind, hash: string): Promise<string[]> {
    return parsePreview(await this.run(previewArgs(kind, hash), undefined, [1]));
  }

  private async hasUnmerged(): Promise<boolean> {
    return (await this.run(['diff', '--name-only', '--diff-filter=U'])).trim() !== '';
  }

  /** Runs an operation. Conflicts are a result, not an error: the operation stays open (MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD). */
  private async attempt(args: string[], env?: NodeJS.ProcessEnv): Promise<Outcome> {
    try {
      await this.run(args, undefined, [], env);
      return { conflicted: false };
    } catch (e) {
      if (await this.hasUnmerged()) return { conflicted: true, output: gitOutput(e) };
      throw e;
    }
  }

  merge(ref: string, option: MergeOption): Promise<Outcome> {
    return this.attempt(mergeArgs(ref, option));
  }

  cherryPick(hash: string, o: { commit: boolean; appendOrigin: boolean }): Promise<Outcome> {
    return this.attempt(cherryPickArgs(hash, o));
  }

  revert(hash: string, o: { commit: boolean }): Promise<Outcome> {
    return this.attempt(revertArgs(hash, o));
  }

  /** Moves the current branch to `hash`. The previous tip stays reachable through ORIG_HEAD and the reflog. */
  async reset(hash: string, mode: ResetMode): Promise<void> {
    await this.run(resetArgs(hash, mode));
  }

  /** Replays the current branch on top of `onto`. Stops with conflicts as a result; the rebase stays open (REBASE_HEAD). */
  async rebase(onto: string, o: { autostash: boolean }): Promise<Outcome> {
    await this.clearPlan();
    if (o.autostash) await this.rememberStaged();
    return this.clearPlanWhenDone(await this.attemptOrClear(rebaseArgs(onto, o)));
  }

  /** Continues a stopped rebase with the message Git proposes (no editor); may stop again at the next conflict. */
  async rebaseContinue(): Promise<Outcome> {
    return this.clearPlanWhenDone(await this.attempt(['-c', 'core.editor=true', 'rebase', '--continue']));
  }

  /** Drops the commit the rebase is stuck on; may stop again at the next conflict. */
  async rebaseSkip(): Promise<Outcome> {
    return this.clearPlanWhenDone(await this.attempt(['rebase', '--skip']));
  }

  /** Where the message files of an interactive rebase live; they must outlast a stop on conflicts. */
  private async planDir(): Promise<string> {
    return path.resolve(this.root, (await this.run(['rev-parse', '--git-path', 'bonsai-rebase'])).trim());
  }

  private async clearPlan(): Promise<void> {
    await fs.rm(await this.planDir(), { recursive: true, force: true });
  }

  /** Once the rebase is over (not stopped on conflicts): staged files come back as staged, the leftovers go. */
  private async clearPlanWhenDone(o: Outcome): Promise<Outcome> {
    if (!o.conflicted) {
      await this.restoreStaged();
      await this.clearPlan();
    }
    return o;
  }

  /** A rebase that fails without starting leaves nothing behind that should outlast the error. */
  private async attemptOrClear(args: string[], env?: NodeJS.ProcessEnv): Promise<Outcome> {
    try { return await this.attempt(args, env); } catch (e) { await this.clearPlan(); throw e; }
  }

  /**
   * With --autostash Git brings the stash back with `stash apply`, which leaves everything unstaged (new files
   * excepted). So the staged entries are noted before the rebase, in the same directory as the other leftovers, and
   * staged again afterwards.
   */
  private async rememberStaged(): Promise<void> {
    const entries = parseStagedRaw(await this.run(['diff', '--cached', '--raw', '--no-abbrev', '-z', '--no-renames']));
    if (!entries.length) return;
    const dir = await this.planDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'staged.json'), JSON.stringify(entries));
  }

  /** Best effort: if anything is off (conflicts from the stash, changed files), the files simply stay unstaged. */
  private async restoreStaged(): Promise<void> {
    try {
      const entries: StagedEntry[] = JSON.parse(await fs.readFile(path.join(await this.planDir(), 'staged.json'), 'utf8'));
      if (!entries.length || await this.hasUnmerged()) return;
      const heads = new Map<string, string>();
      for (let i = 0; i < entries.length; i += 200) {
        const chunk = entries.slice(i, i + 200).map(e => e.path); // ls-tree takes plain paths, not pathspecs
        for (const rec of (await this.run(['ls-tree', '-z', 'HEAD', '--', ...chunk])).split('\0')) {
          const m = /^\d+ \w+ ([0-9a-f]+)\t(.*)$/s.exec(rec);
          if (m) heads.set(m[2], m[1]);
        }
      }
      const info = restoreIndexInfo(entries, heads);
      if (info) await this.run(['update-index', '-z', '--index-info'], info);
    } catch { /* nothing noted, or not restorable */ }
  }

  /**
   * The commits from `hash` to HEAD for the dialog of an interactive rebase onto the parent of `hash`, oldest first.
   * `onBranch` is false if `hash` is not an ancestor of HEAD, `merges` if the range holds merge commits (which the
   * plain todo list would flatten).
   */
  async rebaseRange(hash: string): Promise<{ base: string; commits: RebaseCommit[]; onBranch: boolean; merges: boolean }> {
    const onBranch = await this.run(['merge-base', '--is-ancestor', hash, 'HEAD']).then(() => true, () => false);
    if (!onBranch) return { base: '', commits: [], onBranch, merges: false };
    return this.rebaseRangeOnto((await this.run(['rev-parse', hash + '^'])).trim());
  }

  /** The commits of HEAD that `base` lacks, oldest first, for the dialog of an interactive rebase onto `base`. */
  async rebaseRangeOnto(base: string): Promise<{ base: string; commits: RebaseCommit[]; onBranch: boolean; merges: boolean }> {
    const out = await this.run(['log', '--reverse', '--topo-order', `--format=%H${US}%P${US}%s${US}%B${RS}`, `${base}..HEAD`]);
    const rows = out.split(RS).filter(r => r.trim()).map(r => r.trim().split(US));
    return {
      base, onBranch: true,
      merges: rows.some(r => r[1].split(' ').length > 1),
      commits: rows.map(([h, , subject, message]) => ({ hash: h, subject, message: message.trim() })),
    };
  }

  /**
   * Runs `git rebase -i` onto `base` with the todo list built from `entries` (oldest first). Neither the todo list
   * nor a commit message needs an editor: see media/rebaseplan.js. Stops on conflicts as a result.
   */
  async interactiveRebase(base: string, entries: PlanEntry[], o: { autostash: boolean }): Promise<Outcome> {
    const dir = await this.planDir();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    if (o.autostash) await this.rememberStaged();
    const slashes = (p: string) => p.replace(/\\/g, '/'); // Git's shell takes forward slashes on Windows, too
    const plan = buildRebasePlan(entries, n => slashes(path.join(dir, `message-${n}.txt`)));
    const todo = path.join(dir, 'todo');
    await Promise.all([
      fs.writeFile(todo, plan.todo),
      ...plan.messages.map((m, i) => fs.writeFile(path.join(dir, `message-${i + 1}.txt`), m)),
    ]);
    const outcome = await this.attemptOrClear(
      ['-c', 'core.editor=true', 'rebase', '-i', ...(o.autostash ? ['--autostash'] : []), base],
      { GIT_SEQUENCE_EDITOR: `cp "${slashes(todo)}"` },
    );
    return this.clearPlanWhenDone(outcome);
  }

  /** Commits of `ref` that no ref except those in `without` reaches, so they are lost once those refs are gone. */
  async commitsOnlyOn(ref: string, without: string[]): Promise<number> {
    return Number(await this.run(['rev-list', '--count', ref, '--not', ...without.map(r => `--exclude=${r}`), '--all']));
  }

  /** Unmerged commits do not stop it: the flow has warned about them, and with more than Git's -d knows. */
  async deleteBranch(name: string): Promise<void> {
    await this.run(['branch', '-D', '--', name]);
  }

  /** A refspec with full ref names, so that a branch and a tag of the same name cannot be mixed up; `:ref` deletes. */
  async pushRefspec(remote: string, spec: string): Promise<void> {
    await this.run(['push', remote, spec]);
  }

  /** Files that differ between a commit and the working tree, untracked ones as added. */
  async changedSince(hash: string): Promise<FileChange[]> {
    const tracked = parseNameStatus(await this.run(['diff', '--name-status', '--no-renames', '-z', hash, '--']));
    const untracked = (await this.run(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    return [...tracked, ...untracked.map(p => ({ status: 'A', path: p }))];
  }

  /** Git's usual text for a commit: hash, author, date, message. */
  async commitInfo(hash: string): Promise<string> {
    return (await this.run(['show', '-s', '--format=medium', hash])).trim();
  }

  /** Git writes the file itself, so that binary content and other encodings stay byte for byte. */
  async savePatch(hash: string, file: string): Promise<void> {
    await this.run(['format-patch', '-1', `--output=${file}`, hash]);
  }

  /** Fetching from the repository itself moves a branch without checking it out, and only by a fast-forward. */
  async fastForward(name: string): Promise<void> {
    const upstream = (await this.run(['rev-parse', '--symbolic-full-name', `${name}@{upstream}`])).trim();
    await this.run(['fetch', '.', `${upstream}:refs/heads/${name}`]);
  }

  async renameBranch(name: string, to: string): Promise<void> {
    await this.run(['branch', '-m', '--', name, to]);
  }

  /** `upstream` is a remote branch such as origin/x; without one the branch stops tracking. */
  async setUpstream(name: string, upstream?: string): Promise<void> {
    await this.run(upstream ? ['branch', `--set-upstream-to=refs/remotes/${upstream}`, '--', name] : ['branch', '--unset-upstream', '--', name]);
  }

  async createTag(name: string, hash: string): Promise<void> {
    await this.run(['tag', '--', name, hash]);
  }

  async deleteTag(name: string): Promise<void> {
    await this.run(['tag', '-d', '--', name]);
  }

  /** Throws away every uncommitted change to tracked files, conflicts included; untracked files and stashes stay. */
  async discardAll(): Promise<void> {
    await this.run(['reset', '--hard', 'HEAD']);
  }

  /** Aborts the running merge, cherry-pick, revert or rebase and restores the state before it. */
  async abort(kind: StateKind): Promise<void> {
    await this.run([kind === 'cherryPick' ? 'cherry-pick' : kind, '--abort']);
    if (kind === 'rebase') {
      await this.restoreStaged(); // an abort puts the autostash back unstaged as well
      await this.clearPlan();
    }
  }

  /** The Git directory of this working copy, without starting Git: a linked worktree or submodule has a file pointing to it. */
  private async gitDir(): Promise<string> {
    const dotGit = path.join(this.root, '.git');
    try {
      if ((await fs.stat(dotGit)).isDirectory()) return dotGit;
      const target = /^gitdir: (.+)$/m.exec(await fs.readFile(dotGit, 'utf8'))?.[1];
      if (target) return path.resolve(this.root, target.trim());
    } catch { /* set up some other way: Git knows */ }
    return (await this.run(['rev-parse', '--absolute-git-dir'])).trim();
  }

  /** Branch and step of a running rebase (merge backend: .git/rebase-merge), undefined if none is running. */
  private async rebaseProgress(dir: string): Promise<RebaseProgress | undefined> {
    try {
      const read = async (name: string) => (await fs.readFile(path.join(dir, 'rebase-merge', name), 'utf8')).trim();
      // head-name proves a rebase is running; the lists may be missing for a moment, then the counts are 0
      const [head, done, todo] = await Promise.all([read('head-name'), read('done').catch(() => ''), read('git-rebase-todo').catch(() => '')]);
      return { branch: head.replace(/^refs\/heads\//, ''), ...replaySteps(done, todo) };
    } catch { return undefined; }
  }

  /**
   * The hash in a marker ref. Reads the file: this runs on every refresh, and four Git processes in a row were most of
   * its time. Only a reftable repository keeps these refs elsewhere.
   */
  private async marker(dir: string, name: string): Promise<string | undefined> {
    try {
      if (await fs.stat(path.join(dir, 'reftable')).then(() => true, () => false)) return (await this.run(['rev-parse', '-q', '--verify', name])).trim();
      return /^[0-9a-f]{40,64}/m.exec(await fs.readFile(path.join(dir, name), 'utf8'))?.[0];
    } catch { return undefined; }
  }

  /** The merge, cherry-pick or revert in progress, recognised by its marker ref; undefined if none. */
  async mergeState(): Promise<MergeState | undefined> {
    const dir = await this.gitDir();
    let kind: StateKind | undefined;
    let hash = '';
    for (const [k, marker] of MARKERS) {
      const found = await this.marker(dir, marker);
      if (found) { hash = found; kind = k; break; }
    }
    if (!kind) return undefined;
    if (kind === 'rebase') {
      // Git leaves a stale REBASE_HEAD behind after a finished rebase, so the rebase directory decides
      const rebase = await this.rebaseProgress(dir);
      return rebase && { kind, rebase, theirs: hash.slice(0, 7), hash, message: '' };
    }
    let message = '';
    try {
      message = await fs.readFile(path.join(dir, 'MERGE_MSG'), 'utf8');
    } catch { /* no message */ }
    const named = kind === 'merge' ? /^Merge (?:remote-tracking )?(?:branch|tag|commit) '([^']+)'/.exec(message)?.[1] : undefined;
    return {
      kind, theirs: named ?? hash.slice(0, 7), hash,
      message: message.split('\n').filter(l => !l.startsWith('#')).join('\n').trim(),
    };
  }

  /** Existing index stages of a conflicted file: 1 = base, 2 = ours, 3 = theirs. */
  private async stages(rel: string): Promise<Set<number>> {
    const out = await this.run(['ls-files', '-u', '-z', '--', rel]);
    return new Set(out.split('\0').map(l => /^\d+ \w+ (\d)\t/.exec(l)?.[1]).filter(Boolean).map(Number));
  }

  /** What each side did to a conflicted file. `theirsRef` is the commit of the other side; without one (stash apply) only the kind of change is known. */
  async conflictSides(rel: string, theirsRef?: string): Promise<{ ours: ConflictSide; theirs: ConflictSide }> {
    const stages = await this.stages(rel);
    const side = async (stage: number, ref?: string): Promise<ConflictSide> => {
      const change = !stages.has(stage) ? 'deleted' : stages.has(1) ? 'modified' : 'added';
      if (!ref) return { change };
      try {
        const [hash, subject, date] = (await this.run(['log', '-1', `--format=%h${US}%s${US}%at`, ref, '--', rel])).trim().split(US);
        return { change, hash, subject, date: Number(date) };
      } catch { return { change }; }
    };
    return { ours: await side(2, 'HEAD'), theirs: await side(3, theirsRef) };
  }

  /** Raw content of an index stage (1 = base, 2 = ours, 3 = theirs); undefined if the stage does not exist. */
  private blob(stage: number, rel: string): Promise<Buffer | undefined> {
    return this.git.runBinary(['show', `:${stage}:${rel}`]);
  }

  /**
   * Conflict blocks for the merge dialog. Git merges everything uncontested via `merge-file --diff3`,
   * leaving the real conflicts. Not possible for deleted sides, binary/non-UTF-8 files and very large files.
   */
  async mergeInputs(rel: string): Promise<({ ok: true } & ParsedMerge) | { ok: false; reason: 'deleted' | 'binary' | 'large' }> {
    const [base, ours, theirs] = await Promise.all([1, 2, 3].map(s => this.blob(s, rel)));
    if (!ours || !theirs) return { ok: false, reason: 'deleted' };
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let o: string, t: string;
    try {
      o = decoder.decode(ours);
      t = decoder.decode(theirs);
      if (base) decoder.decode(base);
    } catch { return { ok: false, reason: 'binary' }; }
    if (o.includes('\0') || t.includes('\0')) return { ok: false, reason: 'binary' };
    if (Math.max(o.split('\n').length, t.split('\n').length) > 5000) return { ok: false, reason: 'large' };

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bonsai-'));
    try {
      const files = ['ours', 'base', 'theirs'].map(n => path.join(dir, n));
      await Promise.all([fs.writeFile(files[0], ours), fs.writeFile(files[1], base ?? Buffer.alloc(0)), fs.writeFile(files[2], theirs)]);
      // Exit code = number of conflicts (1..127), not an error
      const merged = await this.run(
        ['merge-file', '-p', '--diff3', '-L', LABEL_OURS, '-L', LABEL_BASE, '-L', LABEL_THEIRS, ...files],
        undefined, Array.from({ length: 127 }, (_, i) => i + 1));
      return { ok: true, ...parseMergeFile(merged, o.includes('\r\n') ? '\r\n' : '\n') };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  /** Write the resolved file and stage it. */
  async writeResolved(rel: string, content: string): Promise<void> {
    const abs = path.resolve(this.root, rel);
    if (!isInside(this.root, abs)) throw new Error(`Invalid path: ${rel}`);
    await fs.writeFile(abs, content, 'utf8');
    await this.run(['add', '--', rel]);
  }

  /** Resolve a conflict with one side and stage it. If that side deleted the file, it is removed. */
  async resolveUsing(rels: string[], side: 'ours' | 'theirs'): Promise<void> {
    for (const rel of rels) {
      if ((await this.stages(rel)).has(side === 'ours' ? 2 : 3)) {
        await this.run(['checkout', `--${side}`, '--', rel]);
        await this.run(['add', '--', rel]);
      } else {
        await this.run(['rm', '-q', '--', rel]);
      }
    }
  }

  async lastCommitMessage(): Promise<string> {
    try { return (await this.run(['log', '-1', '--format=%B'])).trim(); } catch { return ''; }
  }

  async head(): Promise<string | undefined> {
    try { return (await this.run(['rev-parse', 'HEAD'])).trim(); } catch { return undefined; }
  }

  async details(hash: string, stash = false): Promise<CommitDetails> {
    const meta = parseCommitMeta(await this.run(['show', '-s', DETAILS_FORMAT, hash]));
    const parentList = meta.parents;

    // For merges, compare against the first parent (like Fork).
    const diffArgs = parentList.length
      ? ['diff', '--name-status', '-z', '-M', parentList[0], meta.hash]
      : ['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '-M', meta.hash];
    const files = parseNameStatus(await this.run(diffArgs));

    // Stash with -u: untracked files are in the 3rd parent
    if (stash && parentList.length >= 3) {
      const untracked = await this.run(['ls-tree', '-r', '-z', '--name-only', parentList[2]]);
      for (const p of untracked.split('\0').filter(Boolean)) {
        files.push({ status: 'U', path: p, base: EMPTY_TREE, target: parentList[2] });
      }
    }

    return { ...meta, files };
  }
}
