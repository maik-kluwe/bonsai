import type { ToHost } from './protocol';
import { stashLabel } from './changes';

/** One Git command an action ran. `output` is what Git printed (stdout and stderr together). */
export interface LoggedCommand {
  command: string;
  output: string;
  ok: boolean;
}

/** What the user did and what came of it: one entry per click, however many Git commands it took. */
export interface ActivityEntry {
  id: number;
  /** ms since epoch */
  time: number;
  repo: string;
  title: string;
  subtitle?: string;
  ok: boolean;
  /** Only commands that change something; reading commands (log, diff, rev-parse …) are left out. */
  commands: LoggedCommand[];
  error?: string;
  /** Some steps went through the VS Code Git API, which does not tell us the command line. */
  viaApi: boolean;
}

/** Collects what happens while one action runs. */
export class ActivityRecorder {
  commands: LoggedCommand[] = [];
  /** Set when the action called the Git extension API instead of the CLI. */
  api = false;
  error: string | undefined;
}

export const MAX_ENTRIES = 100;
export const MAX_OUTPUT = 4000;

const WRITE_COMMANDS = new Set([
  'add', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'commit', 'fetch', 'merge', 'pull', 'push',
  'rebase', 'reset', 'restore', 'revert', 'rm', 'switch', 'tag', 'update-index', 'update-ref',
]);

/** Whether a Git command changes the repository. `-c key=value` pairs and `--options` in front of the command are skipped. */
export function isWriteCommand(args: string[]): boolean {
  let i = 0;
  for (;;) {
    if (args[i] === '-c') i += 2;
    else if (args[i]?.startsWith('--')) i += 1;
    else break;
  }
  const cmd = args[i];
  if (cmd === 'stash') return args[i + 1] !== 'list' && args[i + 1] !== 'create'; // `create` only builds a commit nobody refers to
  return WRITE_COMMANDS.has(cmd);
}

const quote = (a: string) => (/^[\w@{}./:=,+%^~*-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

export const formatCommand = (args: string[]): string => ['git', ...args.map(quote)].join(' ');

const short = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const files = (n: number) => (n === 1 ? '1 File' : `${n} Files`);
const firstLine = (s: string) => s.split('\n').find(l => l.trim())?.trim() ?? '';

/**
 * Title and subtitle of the log entry a message from the webview leads to; undefined for messages that only read
 * or navigate. Whether anything was really done is decided later: a cancelled dialog leaves no entry.
 */
export function describeAction(m: ToHost): { title: string; subtitle?: string } | undefined {
  switch (m.type) {
    case 'action': return { title: { stash: 'Stash', snapshot: 'Snapshot', branch: 'Create branch' }[m.action] };
    case 'fetch': return { title: 'Fetch', subtitle: m.remote };
    // The first half of a pull: it fetches, then waits for the dialog
    case 'pullPrepare': return { title: 'Fetch' };
    case 'pull': return { title: m.rebase ? 'Pull (rebase)' : 'Pull' };
    case 'push': return { title: m.force ? 'Force push' : 'Push', subtitle: `${m.branch} → ${m.remote}/${m.remoteBranch}` };
    case 'hunk': return { title: `${cap(m.action)} hunk`, subtitle: m.path };
    case 'lines': return { title: `${cap(m.action)} lines`, subtitle: m.path };
    case 'stage': case 'unstage': case 'discard':
      return { title: `${cap(m.type)} ${files(m.paths.length)}`, subtitle: m.paths.length === 1 ? m.paths[0] : undefined };
    case 'resolveUsing': return { title: `Resolve using ${m.side}`, subtitle: m.paths.length === 1 ? m.paths[0] : files(m.paths.length) };
    case 'mergeResolve': return { title: 'Resolve conflicts', subtitle: m.path };
    case 'merge': return { title: 'Merge', subtitle: short(m.ref) };
    case 'cherryPick': return { title: 'Cherry-pick', subtitle: short(m.hash) };
    case 'revert': return { title: 'Revert', subtitle: short(m.hash) };
    case 'reset': return { title: 'Reset', subtitle: short(m.hash) };
    case 'rebase': return { title: 'Rebase', subtitle: short(m.ref) };
    case 'rebaseContinue': return { title: 'Continue rebase' };
    case 'rebaseSkip': return { title: 'Skip commit' };
    case 'mergeAbort': return { title: 'Abort' };
    case 'commit': return { title: m.amend ? 'Amend' : 'Commit', subtitle: firstLine(m.message) || undefined };
    case 'checkout': return { title: 'Checkout', subtitle: m.ref };
    case 'createBranchAt': return { title: 'Create branch', subtitle: short(m.hash) };
    case 'deleteBranch': case 'deleteRemoteBranch': return { title: 'Delete branch', subtitle: m.name };
    case 'renameBranch': return { title: 'Rename branch', subtitle: m.name };
    case 'setTracking': return { title: 'Tracking', subtitle: m.name };
    case 'createTagAt': return { title: 'Create tag', subtitle: short(m.hash) };
    case 'deleteTag': return { title: 'Delete tag', subtitle: m.name };
    case 'pushTag': return { title: 'Push tag', subtitle: m.name };
    case 'fastForward': return { title: 'Fast-forward', subtitle: m.name };
    case 'pullInto': return { title: 'Pull', subtitle: m.ref };
    case 'stashFiles':
      return { title: `Stash ${files(m.paths.length)}`, subtitle: m.message || (m.paths.length === 1 ? m.paths[0] : undefined) };
    case 'stashAction':
      return { title: { apply: 'Apply stash', drop: 'Delete stash', rename: 'Rename stash' }[m.action], subtitle: stashLabel(m.name) };
    default: return undefined;
  }
}

/** Everything done in this session, newest first. Not saved anywhere. */
export class ActivityLog {
  private list: ActivityEntry[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get entries(): readonly ActivityEntry[] {
    return this.list;
  }

  /**
   * Adds the entry for a finished action. Returns undefined, and logs nothing, when the action neither ran a
   * changing command nor called the API nor failed: that is a dialog the user cancelled.
   */
  record(desc: { title: string; subtitle?: string }, repo: string, rec: ActivityRecorder): ActivityEntry | undefined {
    if (!rec.error && !rec.api && !rec.commands.length) return undefined;
    const entry: ActivityEntry = {
      id: ++this.seq,
      time: this.now(),
      repo,
      title: desc.title,
      subtitle: rec.error ? firstLine(rec.error) : desc.subtitle,
      ok: !rec.error,
      commands: rec.commands.map(c => ({ ...c, output: clip(c.output) })),
      error: rec.error && clip(rec.error),
      viaApi: rec.api,
    };
    this.list = [entry, ...this.list].slice(0, MAX_ENTRIES);
    return entry;
  }
}

const clip = (s: string) => {
  const text = s.trim();
  return text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + '\n…' : text;
};
