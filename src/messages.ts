import { diffPayload, type ToHost, type ToWebview } from './protocol';
import { parseDiff } from './diff';
import { commitDiffRefs } from './diffTargets';
import {
  applyHunk, applyLines, discardFiles, runAbort, runAction, runBranchAt, runCheckout, runCherryPick, runCommit, runMerge, runNewBranch, runPush,
  runDeleteBranch, runDeleteRemoteBranch, runDeleteTag, runFastForward, runPullInto, runPushTag, runRenameBranch, runSavePatch, runTagAt, runTracking, runRebase, runRebaseContinue, runRebaseSkip, runReset, runRevert, runStashAction, runStashFiles, stageFiles, unstageFiles, type FlowCtx,
} from './flows';

/** What a message handler may use: the flow context and a way to answer the webview. */
export interface MessageCtx extends FlowCtx {
  post(msg: ToWebview): void;
}

/**
 * The messages the panel answers itself, because they are about the window, not the repository: choosing the
 * repository, paging the log, opening editors, the clipboard. Everything else is in `repoHandlers`.
 */
export const VIEW_TYPES = [
  'ready', 'selectRepo', 'refresh', 'loadMore', 'saveLook', 'activity', 'copy', 'openDiff', 'openChange', 'openFile', 'loadDiff',
  'mergeEditor', 'interactiveRebase', 'interactiveRebaseOnto', 'compareLocal', 'copyCommitInfo', 'openUrl',
] as const satisfies readonly ToHost['type'][];

export type ViewType = typeof VIEW_TYPES[number];
export type RepoType = Exclude<ToHost['type'], ViewType>;
/** The message of type K; also finds `stage`, which shares one union member with `unstage` and `discard`. */
type Msg<K extends ToHost['type']> = ToHost extends infer U ? (U extends { type: infer T } ? ([K] extends [T] ? U : never) : never) : never;

/** A handler; `readOnly` ones change nothing, so the panel does not refresh after them. */
interface Handler<K extends RepoType> {
  run(m: Msg<K>, c: MessageCtx): Promise<void>;
  readOnly?: true;
}

/** The view shows a new branch in the sidebar. */
async function announceBranch(c: MessageCtx, created: Promise<string | undefined>): Promise<void> {
  const name = await created;
  if (name) c.post({ type: 'branchCreated', name });
}

/**
 * One handler per message type that acts on the repository. The mapped type is the exhaustiveness check: add a type
 * to `ToHost` and this stops compiling until it has a handler (or is listed in VIEW_TYPES).
 */
export const repoHandlers: { [K in RepoType]: Handler<K> } = {
  action: { run: (m, c) => (m.action === 'branch' ? announceBranch(c, runNewBranch(c)) : runAction(c, m.action)) },
  push: {
    run: async (m, c) => {
      const output = await runPush(c, m);
      if (output) c.post({ type: 'pushResult', output });
    },
  },
  checkout: { run: (m, c) => runCheckout(c, m.ref) },
  createBranchAt: { run: (m, c) => announceBranch(c, runBranchAt(c, m.hash)) },
  deleteBranch: { run: (m, c) => runDeleteBranch(c, m.name) },
  deleteRemoteBranch: { run: (m, c) => runDeleteRemoteBranch(c, m.name) },
  renameBranch: { run: (m, c) => runRenameBranch(c, m.name) },
  setTracking: { run: (m, c) => runTracking(c, m.name) },
  createTagAt: { run: (m, c) => runTagAt(c, m.hash) },
  deleteTag: { run: (m, c) => runDeleteTag(c, m.name) },
  pushTag: { run: (m, c) => runPushTag(c, m.name) },
  savePatch: { readOnly: true, run: (m, c) => runSavePatch(c, m.hash, m.subject) },
  fastForward: { run: (m, c) => runFastForward(c, m.name) },
  pullInto: { run: (m, c) => runPullInto(c, m.ref) },
  stashAction: { run: (m, c) => runStashAction(c, m) },
  stashFiles: { run: (m, c) => runStashFiles(c, m.paths, m.message) },
  stage: { run: (m, c) => stageFiles(c, m.paths) },
  unstage: { run: (m, c) => unstageFiles(c, m.paths) },
  discard: { run: (m, c) => discardFiles(c, m.paths) },
  hunk: { run: (m, c) => applyHunk(c, m) },
  lines: { run: (m, c) => applyLines(c, m) },
  resolveUsing: { run: (m, c) => c.svc.resolveUsing(m.paths, m.side) },
  mergeResolve: { run: (m, c) => c.svc.writeResolved(m.path, m.content) },
  merge: { run: (m, c) => runMerge(c, m.ref) },
  cherryPick: { run: (m, c) => runCherryPick(c, m.hash) },
  revert: { run: (m, c) => runRevert(c, m.hash) },
  reset: { run: (m, c) => runReset(c, m.hash) },
  rebase: { run: (m, c) => runRebase(c, m.ref) },
  rebaseContinue: { run: (_, c) => runRebaseContinue(c) },
  rebaseSkip: { run: (_, c) => runRebaseSkip(c) },
  mergeAbort: { run: (_, c) => runAbort(c) },
  commit: {
    run: async (m, c) => {
      await runCommit(c, m.message, m.amend);
      c.post({ type: 'committed' });
    },
  },
  details: { readOnly: true, run: async (m, c) => c.post({ type: 'details', details: await c.svc.details(m.hash, m.stash) }) },
  fileDiff: {
    readOnly: true,
    run: async (m, c) => {
      const { left, right } = commitDiffRefs(m);
      const raw = await c.svc.diffRefs(left, right, m.path, m.oldPath, m.context, m.ignoreSpace);
      c.post({ type: 'fileDiff', hash: m.hash, path: m.path, context: m.context, ignoreSpace: m.ignoreSpace, ...diffPayload(parseDiff(raw)) });
    },
  },
  mergeInputs: { readOnly: true, run: async (m, c) => c.post({ type: 'mergeInputs', path: m.path, result: await c.svc.mergeInputs(m.path) }) },
  recentMessages: { readOnly: true, run: async (_, c) => c.post({ type: 'recentMessages', messages: await c.svc.recentMessages(30) }) },
  lastMessage: { readOnly: true, run: async (_, c) => c.post({ type: 'lastMessage', message: await c.svc.lastCommitMessage() }) },
};

/** Repository messages that only read. */
export const READ_ONLY_TYPES = (Object.keys(repoHandlers) as RepoType[]).filter(type => repoHandlers[type].readOnly);

export const isRepoMessage =(m: ToHost): m is Extract<ToHost, { type: RepoType }> =>
  Object.prototype.hasOwnProperty.call(repoHandlers, m.type);

/** Runs the handler of a repository message. */
export function handleRepoMessage(m: Extract<ToHost, { type: RepoType }>, c: MessageCtx): Promise<void> {
  return (repoHandlers[m.type].run as (m: ToHost, c: MessageCtx) => Promise<void>)(m, c);
}
