import * as path from 'path';
import { ForcePushMode, Status, type Change, type Repository } from './git';
import type { GitService, Outcome } from './gitService';
import { sanitizePullChoice, type PullInfo } from './protocol';
import { MERGE_OPTIONS, RESET_MODES, createdRemoteBranch, isAuthFailure, remoteMessages, unsupportedWithConflicts, type MergeOption, type PushOptions, type ResetMode } from './operations';
import { checkHunk, hunkPatch, linesPatch, parseDiff } from './diff';
import { mergeInfo } from './snapshot';
import { repoRelative } from './paths';
import { stashLabel } from './changes';
import { t } from './i18n';
import type { Strings } from './i18n';
import type { Ui } from './ui';

/**
 * What the user does to a repository, from the first question to the result: dry run, dialog, Git, follow-up. The
 * flows know nothing of VS Code; they reach the user through `Ui`, the repository through `Repository` and Git
 * through `GitService`, so tests run them against a real temporary repository with scripted answers.
 */
export interface FlowCtx {
  ui: Ui;
  svc: GitService;
  repo: Repository;
  /** Wraps a call into the Git extension API, whose command line we do not see (the activity log notes it). */
  api<T>(call: Promise<T>): Promise<T>;
  /** Runs `fn` while a progress notification is shown. */
  progress<T>(title: string, fn: () => Promise<T>): Promise<T>;
  /** What the user chose last time, kept across sessions. */
  memory: Memory;
}

export interface Memory {
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;
}

/** Where the last choice in the pull dialog is kept. */
export const PULL_CHOICE_KEY = 'bonsai.pullChoice';

/**
 * After an operation: refresh the status and, as Fork does, show what Git printed if it stopped on conflicts.
 * The banner in the panel takes over from there, so the dialog only informs.
 */
export async function finish(ui: Ui, repo: Repository, outcome?: Outcome): Promise<void> {
  await repo.status();
  if (outcome?.conflicted) {
    await ui.conflicts(outcome.output, repo.state.mergeChanges.map(c => repoRelative(repo.rootUri.fsPath, c.uri.fsPath)));
  }
}

/** Branch names stay as they are; full commit hashes are shortened for display. */
const shown = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

const placeholder = (conflicts: string[], extra = '') =>
  conflicts.length ? `${t('previewConflicts', conflicts.join(', '))}${extra}` : t('previewClean');

/** Changes that a hard reset or a rebase would touch: everything except untracked files. */
const trackedChanges = (repo: Repository): Change[] => {
  const s = repo.state;
  return [...s.indexChanges, ...s.workingTreeChanges, ...s.mergeChanges].filter(c => c.status !== Status.UNTRACKED);
};

const MERGE_TEXT: Record<MergeOption, [keyof Strings, keyof Strings, string]> = {
  default: ['mergeOptDefault', 'mergeOptDefaultDesc', ''],
  noFf: ['mergeOptNoFf', 'mergeOptNoFfDesc', '--no-ff'],
  squash: ['mergeOptSquash', 'mergeOptSquashDesc', '--squash'],
  noCommit: ['mergeOptNoCommit', 'mergeOptNoCommitDesc', '--no-commit'],
};

/**
 * Merge `ref` into the current branch. Shows a dry run first (conflicts named in the placeholder) and the
 * same options as Fork. Squash is withheld when conflicts are expected, see unsupportedWithConflicts().
 */
export async function runMerge(c: FlowCtx, ref: string): Promise<void> {
  const conflicts = await c.svc.preview('merge', ref);
  const offered = MERGE_OPTIONS.filter(o => !unsupportedWithConflicts({ kind: 'merge', option: o }, conflicts));
  const pick = await c.ui.pick(
    offered.map(option => ({
      option,
      label: t(MERGE_TEXT[option][0]),
      description: t(MERGE_TEXT[option][1]),
      detail: MERGE_TEXT[option][2] || undefined,
    })),
    {
      title: t('mergeTitle', shown(ref), c.repo.state.HEAD?.name ?? 'HEAD'),
      placeHolder: placeholder(conflicts, offered.length < MERGE_OPTIONS.length ? ` (${t('squashOff')})` : ''),
    },
  );
  if (!pick) return;
  await finish(c.ui, c.repo, await c.svc.merge(ref, pick.option));
}

/**
 * Cherry-pick `hash` onto the current branch. Expected conflicts are only named in the placeholder: the operation
 * still starts and Bonsai shows it like a merge. Without committing there is nothing to show or abort, so that
 * combination is refused, see unsupportedWithConflicts().
 */
export async function runCherryPick(c: FlowCtx, hash: string): Promise<void> {
  const conflicts = await c.svc.preview('cherryPick', hash);
  const items = [
    { id: 'commit', label: t('optCommit'), picked: true },
    { id: 'origin', label: t('optAppendOrigin'), detail: '-x', picked: false },
  ];
  const picks = await c.ui.pickMany(items, { title: t('cherryTitle', shown(hash)), placeHolder: placeholder(conflicts) });
  if (!picks) return;
  const commit = picks.some(p => p.id === 'commit');
  if (unsupportedWithConflicts({ kind: 'cherryPick', commit }, conflicts)) {
    c.ui.error(t('errNoCommitConflicts', conflicts.join(', ')));
    return;
  }
  await finish(c.ui, c.repo, await c.svc.cherryPick(hash, { commit, appendOrigin: picks.some(p => p.id === 'origin') }));
}

/** Revert `hash`. Expected conflicts are named in the dialog; the operation still starts, see runCherryPick(). */
export async function runRevert(c: FlowCtx, hash: string): Promise<void> {
  const conflicts = await c.svc.preview('revert', hash);
  const subject = (await c.svc.run(['log', '-1', '--format=%s', hash])).trim();
  const choice = await c.ui.choose(
    t('confirmRevert', subject),
    [t('revertBtn'), t('revertNoCommit')],
    conflicts.length ? t('previewConflicts', conflicts.join(', ')) : undefined,
  );
  if (!choice) return;
  await finish(c.ui, c.repo, await c.svc.revert(hash, { commit: choice === t('revertBtn') }));
}

const RESET_TEXT: Record<ResetMode, [keyof Strings, keyof Strings]> = {
  mixed: ['resetMixed', 'resetMixedDesc'],
  soft: ['resetSoft', 'resetSoftDesc'],
  hard: ['resetHard', 'resetHardDesc'],
};

/**
 * Move the current branch to `hash`. Hard is the only mode that destroys work, and only tracked changes
 * (untracked files stay), so the confirmation appears only when there are some.
 */
export async function runReset(c: FlowCtx, hash: string): Promise<void> {
  const pick = await c.ui.pick(
    RESET_MODES.map(mode => ({
      mode, label: t(RESET_TEXT[mode][0]), description: t(RESET_TEXT[mode][1]), detail: `--${mode}`,
    })),
    { title: t('resetTitle', c.repo.state.HEAD?.name ?? 'HEAD', shown(hash)) },
  );
  if (!pick) return;
  if (pick.mode === 'hard') {
    const lost = new Set(trackedChanges(c.repo).map(ch => ch.uri.fsPath)).size;
    if (lost && !(await c.ui.confirm(t('confirmResetHard', lost), t('resetHardBtn')))) return;
  }
  await c.svc.reset(hash, pick.mode);
  await c.repo.status();
}

/**
 * Rebase the current branch onto `ref`. There is no dry run: a rebase replays several commits, each of which can
 * conflict. Conflicts are handled by the banner (Resolve, Continue, Skip, Abort). Git refuses a dirty tree unless
 * the local changes are stashed, so that option is pre-ticked when there are tracked changes.
 */
export async function runRebase(c: FlowCtx, ref: string): Promise<void> {
  const picks = await c.ui.pickMany(
    [{ id: 'autostash', label: t('optAutostash'), detail: '--autostash', picked: trackedChanges(c.repo).length > 0 }],
    { title: t('rebaseTitle', c.repo.state.HEAD?.name ?? 'HEAD', shown(ref)) },
  );
  if (!picks) return;
  await finish(c.ui, c.repo, await c.svc.rebase(ref, { autostash: picks.length > 0 }));
}

/** Continues a stopped rebase; refused while conflicts are open. */
export async function runRebaseContinue(c: FlowCtx): Promise<void> {
  if (c.repo.state.mergeChanges.length) throw new Error(t('errConflicts'));
  await finish(c.ui, c.repo, await c.svc.rebaseContinue());
}

/** Drops the commit the rebase is stuck on, after asking. */
export async function runRebaseSkip(c: FlowCtx): Promise<void> {
  if (await c.ui.confirm(t('confirmRebaseSkip'), t('rebaseSkip'))) await finish(c.ui, c.repo, await c.svc.rebaseSkip());
}

const ABORT_TEXT = { merge: 'confirmAbortMerge', cherryPick: 'confirmAbortCherryPick', revert: 'confirmAbortRevert', rebase: 'confirmAbortRebase' } as const;

/**
 * Aborts whichever of merge, cherry-pick, revert or rebase is running. Conflicts without a marker (stash apply) have
 * nothing to abort, only changes to throw away, which asks for its own confirmation.
 */
export async function runAbort(c: FlowCtx): Promise<void> {
  const running = await c.svc.mergeState();
  if (!running) {
    if (!c.repo.state.mergeChanges.length) return;
    if (await c.ui.confirm(t('confirmDiscardAll'), t('discard'))) { await c.svc.discardAll(); await c.repo.status(); }
    return;
  }
  if (await c.ui.confirm(t(ABORT_TEXT[running.kind]), t('abort'))) { await c.svc.abort(running.kind); await c.repo.status(); }
}

/**
 * Apply a stash as Fork does: a checkbox decides whether the stash is deleted afterwards. It is kept when
 * the apply stops on conflicts, because the files are only half applied and the stash is the way back.
 */
export async function runApplyStash(c: FlowCtx, index: number, name: string): Promise<void> {
  const picks = await c.ui.pickMany(
    [{ id: 'delete', label: t('optDeleteStash'), detail: t('optDeleteStashDetail'), picked: false }],
    { title: t('applyStashTitle', stashLabel(name)) },
  );
  if (!picks) return;
  const outcome = await c.svc.applyStash(index);
  if (!outcome.conflicted && picks.length > 0) await c.repo.dropStash(index);
  await finish(c.ui, c.repo, outcome);
}

/** Stashes chosen files. The Git extension does not hear of this at once, and the lists would show the files for seconds. */
export async function runStashFiles(c: FlowCtx, paths: string[], message: string): Promise<void> {
  await c.svc.stashFiles(paths, message);
  await c.repo.status();
}

export async function runStashAction(c: FlowCtx, m: { action: 'apply' | 'drop' | 'rename'; index: number; name: string }): Promise<void> {
  switch (m.action) {
    case 'apply': return runApplyStash(c, m.index, m.name);
    case 'drop':
      if (await c.ui.confirm(t('confirmDropStash', m.name), t('delete'))) await c.api(c.repo.dropStash(m.index));
      return;
    case 'rename': {
      // As in Fork: show without the Git prefix ("On main: ") and save exactly the entered text
      const shownName = stashLabel(m.name);
      const message = await c.ui.input(t('promptStashName'), shownName);
      if (message && message !== shownName) await c.svc.renameStash(m.index, message);
    }
  }
}

// ---------- Changes ----------

type PatchAction = 'stage' | 'unstage' | 'discard';

/** stage: index forward · unstage: index backward · discard: working copy backward. */
export const patchMode = (action: PatchAction): { cached: boolean; reverse: boolean } =>
  ({ cached: action !== 'discard', reverse: action !== 'stage' });

const abs = (repo: Repository, rel: string) => path.join(repo.rootUri.fsPath, rel);

/** The change shown under `rel`: staged ones come from the index, the others from conflicts, working tree and untracked. */
export function findChange(repo: Repository, rel: string, staged: boolean): Change | undefined {
  const s = repo.state;
  const list = staged ? s.indexChanges : [...s.mergeChanges, ...s.workingTreeChanges, ...s.untrackedChanges];
  return list.find(x => repoRelative(repo.rootUri.fsPath, x.uri.fsPath) === rel);
}

/** Stage, unstage or (after asking) discard one hunk of the diff of `path`. */
export async function applyHunk(c: FlowCtx, m: { path: string; staged: boolean; index: number; action: PatchAction; context: number; expect: string[] }): Promise<void> {
  const untracked = findChange(c.repo, m.path, m.staged)?.status === Status.UNTRACKED;
  const diff = parseDiff(await c.svc.diffLocal(m.path, m.staged, untracked, m.context));
  checkHunk(diff, m.index, m.expect);
  const patch = hunkPatch(diff, m.index);
  if (m.action === 'discard' && !(await c.ui.confirm(t('confirmDiscardHunk'), t('discard')))) return;
  await c.svc.apply(patch, patchMode(m.action));
  await c.repo.status();
}

/** Stage, unstage or (after asking) discard single lines of one hunk; `lines` are indices into the hunk's lines. */
export async function applyLines(c: FlowCtx, m: { path: string; staged: boolean; hunk: number; lines: number[]; action: PatchAction; context: number; expect: string[] }): Promise<void> {
  const untracked = findChange(c.repo, m.path, m.staged)?.status === Status.UNTRACKED;
  const diff = parseDiff(await c.svc.diffLocal(m.path, m.staged, untracked, m.context));
  checkHunk(diff, m.hunk, m.expect);
  const patch = linesPatch(diff, m.hunk, m.lines, m.action === 'stage' ? 'forward' : 'reverse');
  if (m.action === 'discard' && !(await c.ui.confirm(t('confirmDiscardLines', m.lines.length), t('discard')))) return;
  await c.svc.apply(patch, { ...patchMode(m.action), recount: true });
  await c.repo.status();
}

/** Throws away the changes to `paths` after asking; new files are deleted. */
export async function discardFiles(c: FlowCtx, paths: string[]): Promise<void> {
  const label = paths.length === 1 ? `"${paths[0]}"` : t('nFiles', paths.length);
  if (await c.ui.confirm(t('confirmDiscardFiles', label), t('discard'))) await c.api(c.repo.clean(paths.map(p => abs(c.repo, p))));
}

export const stageFiles = (c: FlowCtx, paths: string[]) => c.api(c.repo.add(paths.map(p => abs(c.repo, p))));
export const unstageFiles = (c: FlowCtx, paths: string[]) => c.api(c.repo.revert(paths.map(p => abs(c.repo, p))));

// Same rules as the commit button in the webview (media/commitbox.js)
const { commitBlocker } = require('../media/commitbox.js') as {
  commitBlocker(s: { message: string; amend: boolean; staged: number; merge?: { conflicts: number; kind?: string } }): 'rebasing' | 'noMessage' | 'conflicts' | 'nothingStaged' | null;
};

const COMMIT_ERROR = { rebasing: 'errRebasing', noMessage: 'errNoMessage', conflicts: 'errConflicts', nothingStaged: 'errNothingStaged' } as const;

/** Commits what is staged; throws the reason when the commit box rules say no. */
export async function runCommit(c: FlowCtx, message: string, amend: boolean): Promise<void> {
  const s = c.repo.state;
  const merge = mergeInfo(await c.svc.mergeState(), s.mergeChanges.length, '');
  const blocker = commitBlocker({ message, amend, staged: s.indexChanges.length, merge });
  if (blocker) throw new Error(t(COMMIT_ERROR[blocker]));
  await c.api(c.repo.commit(message, { amend }));
}

// ---------- Toolbar ----------

export async function runAction(c: FlowCtx, action: 'stash' | 'snapshot'): Promise<void> {
  const { repo, ui } = c;
  switch (action) {
    case 'stash': {
      const message = await ui.input(t('promptStashMsg'));
      if (message === undefined) return;
      return c.api(repo.createStash({ message: message || undefined, includeUntracked: true }));
    }
    case 'snapshot': {
      // Snapshot: save the state as a stash, working copy stays unchanged
      const message = await ui.input(t('promptSnapshotMsg'));
      if (message === undefined) return;
      await c.api(repo.createStash({ message: message || undefined, includeUntracked: true }));
      // --index: staged changes stay staged (repo.applyStash does not know the option)
      await c.svc.applyStashWithIndex(0);
      return repo.status();
    }
  }
}

/** Fetches from one remote, or from all; what is gone on the server is removed here, too. */
export function runFetch(c: FlowCtx, remote?: string): Promise<void> {
  return c.progress('Fetch', () => c.api(c.repo.fetch(remote ? { remote, prune: true } : { all: true, prune: true })));
}

/** The checked-out branch and the remote branch it tracks, or undefined after telling the user there is none. */
async function pullTarget(c: FlowCtx): Promise<{ branch: string; upstream: string } | undefined> {
  const branch = c.repo.state.HEAD?.name;
  const head = branch ? (await c.svc.refs()).find(r => r.kind === 'head' && r.name === branch) : undefined;
  if (!branch || !head?.upstream) { c.ui.error(t('errNoUpstream', branch ?? 'HEAD')); return undefined; }
  return { branch, upstream: head.upstream };
}

/**
 * The first half of a pull: fetches the upstream (and prunes, as Fork does) and looks at what the local changes would
 * meet, so that the dialog can say what the boxes will do before Git has refused anything. It starts with what the
 * user ticked the last time; the dialog never ticks a box on its own.
 * Undefined when there is nothing to pull from.
 */
export async function runPullPrepare(c: FlowCtx): Promise<PullInfo | undefined> {
  const target = await pullTarget(c);
  if (!target) return undefined;
  const { remote } = remoteBranch(c, target.upstream);
  await c.progress('Fetch', () => c.api(c.repo.fetch({ remote, prune: true })));
  // The prune may just have removed the branch the upstream setting points to
  const head = (await c.svc.refs()).find(r => r.kind === 'head' && r.name === target.branch);
  if (!head?.upstream || head.gone) { c.ui.error(t('errUpstreamGone', target.upstream)); return undefined; }
  await c.repo.status();
  const last = sanitizePullChoice(c.memory.get(PULL_CHOICE_KEY));
  return {
    upstream: target.upstream, into: target.branch, rebase: await c.svc.pullRebases(target.branch),
    ...(last && { last }), ...(await c.svc.pullPreview(target.upstream)),
  };
}

/** The second half: takes what the first one fetched into the branch. Conflicts are shown as after a merge or a rebase. */
export async function runPull(c: FlowCtx, o: { rebase: boolean; stash: boolean }): Promise<void> {
  const target = await pullTarget(c);
  if (!target) return;
  await c.memory.set(PULL_CHOICE_KEY, { rebase: o.rebase, stash: o.stash });
  const outcome = await c.progress('Pull', () => c.svc.integrate(target.upstream, { rebase: o.rebase, autostash: o.stash }));
  await finish(c.ui, c.repo, outcome);
}

/** Creates a branch from HEAD and switches to it; its name, or undefined if the user cancelled. */
export async function runNewBranch(c: FlowCtx): Promise<string | undefined> {
  const name = await c.ui.input(t('promptBranch'));
  if (!name) return undefined;
  await c.api(c.repo.createBranch(name, true));
  return name;
}

/** Pushes a refspec; without a stored sign-in through the Git extension, as `runPush` does. */
async function pushRefspec(c: FlowCtx, remote: string, spec: string): Promise<void> {
  await c.progress('Push', async () => {
    try {
      await c.svc.pushRefspec(remote, spec);
    } catch (e) {
      if (!isAuthFailure(String((e as Error).message))) throw e;
      await c.api(c.repo.push(remote, spec));
    }
  });
}

/** Splits a remote branch such as origin/feat/x. */
function remoteBranch(c: FlowCtx, full: string): { remote: string; branch: string } {
  const remote = c.repo.state.remotes.map(r => r.name).find(n => full.startsWith(`${n}/`)) ?? full.split('/')[0];
  return { remote, branch: full.slice(remote.length + 1) };
}

function deleteRemoteBranch(c: FlowCtx, full: string): Promise<void> {
  const { remote, branch } = remoteBranch(c, full);
  return pushRefspec(c, remote, `:refs/heads/${branch}`);
}

/**
 * Deletes a local branch, on request with its remote branch. The warning counts what no other ref reaches, which is
 * what is really lost: a branch that is merged, or pushed and kept on the server, needs none. The remote branch goes
 * first, so that a refused push leaves everything in place.
 */
export async function runDeleteBranch(c: FlowCtx, name: string): Promise<void> {
  const refs = await c.svc.refs();
  const upstream = refs.find(r => r.kind === 'head' && r.name === name)?.upstream;
  const remote = refs.some(r => r.kind === 'remote' && r.name === upstream) ? upstream : undefined;
  const local = `refs/heads/${name}`;
  const lost = await c.svc.commitsOnlyOn(local, [local]);
  const lostWithRemote = remote ? await c.svc.commitsOnlyOn(local, [local, `refs/remotes/${remote}`]) : 0;
  const alsoRemote = remote && t('deleteAlsoRemote', remote);
  const answer = await c.ui.choose(
    t('confirmDeleteBranch', name),
    alsoRemote ? [t('delete'), alsoRemote] : [t('delete')],
    lost ? t('deleteLost', lost) : lostWithRemote ? t('deleteLostWithRemote', lostWithRemote) : undefined,
  );
  if (!answer) return;
  if (answer === alsoRemote) await deleteRemoteBranch(c, remote!);
  await c.svc.deleteBranch(name);
  await c.repo.status();
}

export async function runDeleteRemoteBranch(c: FlowCtx, full: string): Promise<void> {
  const ref = `refs/remotes/${full}`;
  const lost = await c.svc.commitsOnlyOn(ref, [ref]);
  if (!(await c.ui.confirm(t('confirmDeleteRemote', full), t('delete'), lost ? t('deleteLost', lost) : undefined))) return;
  await deleteRemoteBranch(c, full);
  await c.repo.status();
}

export async function runRenameBranch(c: FlowCtx, name: string): Promise<void> {
  const to = await c.ui.input(t('promptRenameBranch', name), name);
  if (!to || to === name) return;
  await c.svc.renameBranch(name, to);
  await c.repo.status();
}

/** Fork's Tracking menu as a pick list: remove the upstream, or pick another remote branch. */
export async function runTracking(c: FlowCtx, name: string): Promise<void> {
  const refs = await c.svc.refs();
  const upstream = refs.find(r => r.kind === 'head' && r.name === name)?.upstream;
  const items = [
    ...(upstream ? [{ label: t('trackingRemove'), target: undefined as string | undefined }] : []),
    ...refs.filter(r => r.kind === 'remote').map(r => ({
      label: r.name, target: r.name as string | undefined, description: r.name === upstream ? t('trackingCurrent') : undefined,
    })),
  ];
  if (!items.length) { c.ui.error(t('errNoRemoteBranches')); return; }
  const pick = await c.ui.pick(items, { title: t('trackingTitle', name) });
  if (!pick || pick.target === upstream) return;
  await c.svc.setUpstream(name, pick.target);
  await c.repo.status();
}

export async function runTagAt(c: FlowCtx, hash: string): Promise<void> {
  const name = await c.ui.input(t('promptTagAt', hash.slice(0, 7)));
  if (!name) return;
  await c.svc.createTag(name, hash);
  await c.repo.status();
}

/** One button per remote, since Git only learns whether a remote has the tag by asking it. The remote goes first, as for branches. */
export async function runDeleteTag(c: FlowCtx, name: string): Promise<void> {
  const remotes = c.repo.state.remotes.map(r => r.name);
  const alsoOn = remotes.map(r => t('deleteTagAlsoOn', r));
  const answer = await c.ui.choose(t('confirmDeleteTag', name), [t('delete'), ...alsoOn]);
  if (!answer) return;
  const remote = remotes[alsoOn.indexOf(answer)];
  if (remote) await pushRefspec(c, remote, `:refs/tags/${name}`);
  await c.svc.deleteTag(name);
  await c.repo.status();
}

export async function runPushTag(c: FlowCtx, name: string): Promise<void> {
  const remotes = c.repo.state.remotes.map(r => r.name);
  if (!remotes.length) { c.ui.error(t('errNoRemotes')); return; }
  const to = remotes.map(r => t('pushTagTo', r));
  const answer = await c.ui.choose(t('confirmPushTag', name), to);
  if (!answer) return;
  await pushRefspec(c, remotes[to.indexOf(answer)], `refs/tags/${name}`);
}

export async function runSavePatch(c: FlowCtx, hash: string, subject: string): Promise<void> {
  const name = subject.replace(/[^\p{L}\p{N}._]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || hash.slice(0, 7);
  const file = await c.ui.saveFile(path.join(c.repo.rootUri.fsPath, `${name}.patch`));
  if (file) await c.svc.savePatch(hash, file);
}

export async function runFastForward(c: FlowCtx, name: string): Promise<void> {
  await c.svc.fastForward(name);
  await c.repo.status();
}

/** Fork's "Pull into": a merge that fetches first, so that it takes what is on the server by now. */
export async function runPullInto(c: FlowCtx, full: string): Promise<void> {
  const { remote, branch } = remoteBranch(c, full);
  await c.progress('Fetch', () => c.api(c.repo.fetch({ remote, ref: branch })));
  await runMerge(c, full);
}

/**
 * Pushes and returns what the server said when the push created the remote branch: that is when GitLab's link for a
 * merge request matters, every later push would only repeat it. Without a stored sign-in Git cannot ask anybody, so that case
 * goes through the Git extension, which can; its push does not report the server's answer, and it cannot send tags.
 */
export async function runPush(c: FlowCtx, o: PushOptions): Promise<string> {
  const output = await c.progress('Push', async () => {
    try {
      return await c.svc.push(o);
    } catch (e) {
      if (o.tags || !isAuthFailure(String((e as Error).message))) throw e;
      await c.api(c.repo.push(o.remote, `${o.branch}:${o.remoteBranch}`, o.track, o.force ? ForcePushMode.ForceWithLease : undefined));
      return '';
    }
  });
  await c.repo.status();
  return createdRemoteBranch(output, o.remoteBranch) ? remoteMessages(output) : '';
}

export async function runCheckout(c: FlowCtx, ref: string): Promise<void> {
  await c.progress(`Checkout ${ref}`, () => c.api(c.repo.checkout(ref)));
}

export async function runBranchAt(c: FlowCtx, hash: string): Promise<string | undefined> {
  const name = await c.ui.input(t('promptBranchAt', hash.slice(0, 7)));
  if (!name) return undefined;
  await c.api(c.repo.createBranch(name, true, hash));
  return name;
}
