import * as vscode from 'vscode';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { Status, type API, type Change, type Repository } from './git';
import { GitService, type CommitInfo, type MergeState, type RefInfo } from './gitService';
import { parseDiff } from './diff';
import { repoRelative } from './paths';
import { isConflict, statusLetter, type ChangeItem } from './changes';
import { avatarHashes } from './avatars';
import { buildSnapshot, mergeInfo, snapshotSignature, type MergeInfo } from './snapshot';
import { coalesced } from './coalesced';
import { diffPayload, isToHost, sanitizeLook, type ToHost, type ToWebview } from './protocol';
import { READ_ONLY_TYPES, handleRepoMessage, type MessageCtx } from './messages';
import { changeView, commitDiffRefs, compareRefs, type DiffSide } from './diffTargets';
import { MAIN_SCRIPTS, scriptTags } from './webviewAssets';
import { findChange } from './flows';
import { vscodeUi } from './ui';
import { lang, strings, t } from './i18n';
import { openInteractiveRebase } from './rebasePanel';
import { ActivityLog, ActivityRecorder, describeAction, formatCommand, isWriteCommand } from './activityLog';

/** Where the host keeps the look of the diff toolbar (globalState). */
const LOOK_KEY = 'bonsai.diffLook';

/** The activity log entry the running action belongs to; Git commands and API calls find it here without being passed it. */
const currentAction = new AsyncLocalStorage<ActivityRecorder | undefined>();

/** Refs and HEAD are part of the key, so they stay as true as the commits. */
interface LoadedLog {
  key: string;
  commits: CommitInfo[];
  refs: RefInfo[];
  head: string | undefined;
}

export class BonsaiPanel implements vscode.Disposable {
  static current: BonsaiPanel | undefined;
  /** Kept when the panel is closed and reopened; gone when the window reloads. */
  private static readonly activity = new ActivityLog();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private repoListeners: vscode.Disposable[] = [];
  private stateListener: vscode.Disposable | undefined;
  private repo: Repository | undefined;
  private followScm = true;
  private refreshTimer: NodeJS.Timeout | undefined;
  /** Log cache: only reload when refs/HEAD changed (status events fire on every save). */
  private logCache: LoadedLog | undefined;
  /** How many commits the log may load; grows by `bonsai.maxCommits` each time the list is scrolled to its end. */
  private logLimit = 0;
  /** Merge in progress as of the last refresh (for the cards in the conflict diff). */
  private merge: MergeState | undefined;
  /** Signature of the last sent data packet; identical packets (e.g. after merely saving a file) are skipped, the view only reads its diff again. */
  private lastSig: string | undefined;
  /** Opt-in to Gravatar, read when the panel opens: the page security policy has to allow the images. */
  private readonly gravatar = vscode.workspace.getConfiguration('bonsai').get<boolean>('gravatar', false);

  static show(ctx: vscode.ExtensionContext, git: API) {
    if (BonsaiPanel.current) {
      BonsaiPanel.current.panel.reveal();
      return;
    }
    BonsaiPanel.current = new BonsaiPanel(ctx, git);
  }

  private constructor(private readonly ctx: vscode.ExtensionContext, private readonly git: API) {
    const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('bonsai', 'Bonsai', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    this.panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg');
    this.panel.webview.html = this.html(media);

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) this.scheduleRefresh(); }),
      this.panel.webview.onDidReceiveMessage((m: unknown) => { if (isToHost(m)) void this.onMessage(m); }),
      git.onDidOpenRepository(() => this.pickRepo()),
      git.onDidCloseRepository(() => this.pickRepo()),
    );
    this.pickRepo();
  }

  // ---------- Repository selection ----------

  /** Follows the selection in the Source Control view as long as the user has not chosen manually. */
  private pickRepo(explicitRoot?: string) {
    const repos = this.git.repositories;
    let next: Repository | undefined;
    if (explicitRoot) {
      next = repos.find(r => r.rootUri.fsPath === explicitRoot);
      this.followScm = false;
    } else if (this.followScm || !this.repo || !repos.includes(this.repo)) {
      next = repos.find(r => r.ui.selected) ?? repos[0];
    } else {
      next = this.repo;
    }

    this.repoListeners.forEach(d => d.dispose());
    this.repoListeners = repos.map(r => r.ui.onDidChange(() => {
      if (this.followScm && r.ui.selected && r !== this.repo) this.setRepo(r);
    }));

    this.setRepo(next);
  }

  private setRepo(repo: Repository | undefined) {
    if (repo !== this.repo) {
      this.stateListener?.dispose();
      this.stateListener = repo?.state.onDidChange(() => this.scheduleRefresh());
      this.logCache = undefined;
      this.logLimit = 0;
    }
    this.repo = repo;
    this.lastSig = undefined;
    this.panel.title = repo ? `Bonsai: ${path.basename(repo.rootUri.fsPath)}` : 'Bonsai';
    this.post({
      type: 'repos',
      repos: this.git.repositories.map(r => ({ root: r.rootUri.fsPath, name: path.basename(r.rootUri.fsPath) })),
      selected: repo?.rootUri.fsPath,
    });
    this.refresh();
  }

  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    // The timer inherits the action that scheduled it; its reading commands are not part of that action
    this.refreshTimer = setTimeout(() => currentAction.run(undefined, () => this.refresh()), 300);
  }

  private service(): GitService | undefined {
    return this.repo && new GitService(this.git.git.path, this.repo, (args, stdout, stderr, ok) => {
      if (!isWriteCommand(args)) return;
      currentAction.getStore()?.commands.push({ command: formatCommand(args), output: [stdout, stderr].filter(s => s.trim()).join('\n'), ok });
    });
  }

  /** Marks the running action as done through the Git extension API, whose command line we do not see. */
  private api<T>(call: Promise<T>): Promise<T> {
    const rec = currentAction.getStore();
    if (rec) rec.api = true;
    return call;
  }

  /** Runs `fn` and adds what it did to the activity log. Errors are logged and thrown on. */
  private async logged<T>(desc: { title: string; subtitle?: string }, fn: () => Promise<T>): Promise<T> {
    const rec = new ActivityRecorder();
    try {
      return await currentAction.run(rec, fn);
    } catch (e) {
      rec.error ??= String((e as Error).message ?? e);
      throw e;
    } finally {
      const entry = BonsaiPanel.activity.record(desc, this.repo ? path.basename(this.repo.rootUri.fsPath) : '', rec);
      if (entry) this.post({ type: 'activity', entries: BonsaiPanel.activity.entries });
    }
  }

  // ---------- Data ----------

  private rel(uri: vscode.Uri): string {
    return repoRelative(this.repo!.rootUri.fsPath, uri.fsPath);
  }

  private changeItems(changes: readonly Change[]): ChangeItem[] {
    return changes.map(c => ({
      path: this.rel(c.uri),
      oldPath: c.renameUri ? this.rel(c.originalUri) : undefined,
      status: statusLetter(c.status),
      conflict: isConflict(c.status),
    })).sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Reads and sends the state now; a call during a running read leads to one more read afterwards. */
  private readonly read = coalesced(() => this.load());
  private refresh() {
    clearTimeout(this.refreshTimer);
    return this.read();
  }

  /**
   * The lists as VS Code knows them, on the graph of the last read. Refs, stashes and the merge state take several Git
   * processes, and the lists do not depend on them while HEAD stays where it is.
   * @returns whether a packet went out
   */
  private sendKnownLists(repo: Repository): boolean {
    const log = this.logCache;
    const s = repo.state;
    if (!log || log.head !== s.HEAD?.commit) return false;
    const staged = this.changeItems(s.indexChanges);
    const unstaged = this.changeItems([...s.mergeChanges, ...s.workingTreeChanges, ...s.untrackedChanges]);
    const merge = mergeInfo(this.merge, s.mergeChanges.length, t('incomingSide'));
    const sig = snapshotSignature(log.key, s.HEAD?.name, staged, unstaged, merge);
    if (sig === this.lastSig) return false;
    this.lastSig = sig;
    this.sendSnapshot(repo, log, staged, unstaged, merge);
    return true;
  }

  private sendSnapshot(repo: Repository, log: LoadedLog, staged: ChangeItem[], unstaged: ChangeItem[], merge: MergeInfo | undefined) {
    const s = repo.state;
    const snapshot = buildSnapshot({
      commits: log.commits, more: log.commits.length >= this.logLimit,
      refs: log.refs, head: log.head, currentBranch: s.HEAD?.name, staged, unstaged, merge, remotes: s.remotes.map(r => r.name),
      worktreeSubject: n => t('worktreeRow', n), now: Date.now() / 1000,
    });
    this.post(this.gravatar ? { ...snapshot, avatars: avatarHashes(snapshot.commits) } : snapshot);
  }

  private async load() {
    const svc = this.service();
    const repo = this.repo;
    if (!svc || !repo) {
      this.post({ type: 'data', commits: [], more: false, rows: [], refs: [], maxWidth: 0, staged: [], unstaged: [], changeCount: 0 });
      return;
    }
    try {
      const listsSent = this.sendKnownLists(repo);
      const [refs, head, merge] = await Promise.all([svc.refs(), svc.head(), svc.mergeState()]);
      this.merge = merge;
      const max = vscode.workspace.getConfiguration('bonsai').get<number>('maxCommits', 1000);
      if (this.logLimit < max) this.logLimit = max; // also follows a lowered or raised setting
      const limit = this.logLimit;
      const key = `${limit}|${head ?? ''}|${JSON.stringify(refs)}`;
      if (this.logCache?.key !== key) this.logCache = { key, commits: await svc.log(limit), refs, head };

      const s = repo.state;
      const staged = this.changeItems(s.indexChanges);
      const unstaged = this.changeItems([...s.mergeChanges, ...s.workingTreeChanges, ...s.untrackedChanges]);
      const mInfo = mergeInfo(merge, s.mergeChanges.length, t('incomingSide'));

      const sig = snapshotSignature(key, s.HEAD?.name, staged, unstaged, mInfo);
      // A packet that went out above makes the view read its diff anyway
      if (sig === this.lastSig) { if (!listsSent) this.post({ type: 'recheck' }); return; }
      this.lastSig = sig;
      this.sendSnapshot(repo, this.logCache, staged, unstaged, mInfo);
    } catch (e) {
      this.lastSig = undefined; // next refresh should clear the error notice again
      this.post({ type: 'error', message: String((e as Error).message ?? e) });
    }
  }

  // ---------- Messages from the webview ----------

  private async onMessage(m: ToHost): Promise<void> {
    const described = describeAction(m);
    // Runs again inside logged(); the recorder is then set and the message is handled for real
    if (described && !currentAction.getStore()) return this.logged(described, () => this.onMessage(m)).catch(() => undefined);
    const repo = this.repo;
    try {
      switch (m.type) {
        case 'ready':
          this.post({ type: 'look', look: this.ctx.globalState.get(LOOK_KEY) === undefined ? undefined : sanitizeLook(this.ctx.globalState.get(LOOK_KEY)) });
          this.pickRepo();
          return;
        case 'saveLook': await this.ctx.globalState.update(LOOK_KEY, sanitizeLook(m.look)); return;
        case 'activity': this.post({ type: 'activity', entries: BonsaiPanel.activity.entries }); return;
        case 'refresh': this.logCache = undefined; this.lastSig = undefined; await this.repo?.status(); this.refresh(); return;
        case 'selectRepo': this.pickRepo(m.root); return;
        case 'loadMore':
          this.logLimit += vscode.workspace.getConfiguration('bonsai').get<number>('maxCommits', 1000);
          this.refresh();
          return;
        case 'copy': await vscode.env.clipboard.writeText(m.text); return;
      }
      if (!repo) return;

      switch (m.type) {
        case 'openDiff': {
          // The git: provider throws "file not found" for paths that do not exist in the ref: commitDiffRefs uses the empty tree there
          const { left: leftRef, right: rightRef } = commitDiffRefs(m);
          const left = this.git.toGitUri(vscode.Uri.joinPath(repo.rootUri, m.oldPath ?? m.path), leftRef);
          const right = this.git.toGitUri(vscode.Uri.joinPath(repo.rootUri, m.path), rightRef);
          await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(m.path)} (${m.hash.slice(0, 7)})`, { preview: true });
          return;
        }
        case 'openChange': await this.openChange(repo, m.path, m.staged); return;
        case 'openUrl': if (/^https?:\/\//i.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url, true)); return;
        case 'openFile': await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(repo.rootUri, m.path)); return;
        case 'loadDiff': await this.loadDiff(repo, m.path, m.staged, m.context); return;
        case 'mergeEditor': await vscode.commands.executeCommand('git.openMergeEditor', vscode.Uri.joinPath(repo.rootUri, m.path)); return;
        // Opening the dialog changes nothing; starting the rebase from it is what lands in the activity log
        case 'interactiveRebase': await openInteractiveRebase(this.ctx.extensionUri, this.service()!, repo, await this.service()!.rebaseRange(m.hash),
          run => this.logged({ title: 'Interactive rebase', subtitle: m.hash.slice(0, 7) }, run)); break;
        case 'interactiveRebaseOnto': await openInteractiveRebase(this.ctx.extensionUri, this.service()!, repo, await this.service()!.rebaseRangeOnto(m.ref),
          run => this.logged({ title: 'Interactive rebase', subtitle: m.ref }, run)); break;
        case 'compareLocal': await this.compareLocal(repo, m.hash); return;
        case 'copyCommitInfo': await vscode.env.clipboard.writeText(await this.service()!.commitInfo(m.hash)); return;
        // Every other type acts on the repository: messages.ts. The type checker leaves exactly those here.
        default: {
          const c: MessageCtx = {
            ui: vscodeUi, svc: this.service()!, repo,
            api: call => this.api(call), progress: (title, fn) => this.withProgress(title, fn), post: msg => this.post(msg),
          };
          await handleRepoMessage(m, c);
          if (READ_ONLY_TYPES.includes(m.type)) return;
        }
      }
    } catch (e) {
      const rec = currentAction.getStore();
      if (rec) rec.error = String((e as Error).message ?? e);
      vscode.window.showErrorMessage(`Bonsai: ${(e as Error).message ?? e}`);
    }
    // No waiting: what the action changed is known by now. The reading commands are not part of the action.
    void currentAction.run(undefined, () => this.refresh());
  }

  /** Diff for the embedded view (right of the lists). */
  private async loadDiff(repo: Repository, rel: string, staged: boolean, context?: number) {
    const c = findChange(repo, rel, staged);
    if (!c) { this.post({ type: 'diff', path: rel, staged, missing: true }); return; }
    if (isConflict(c.status)) {
      const sides = await this.service()!.conflictSides(rel, this.merge?.hash);
      this.post({ type: 'diff', path: rel, staged, conflict: true, sides });
      return;
    }
    const untracked = c.status === Status.UNTRACKED;
    const raw = await this.service()!.diffLocal(rel, staged, untracked, context);
    const d = parseDiff(raw);
    this.post({
      type: 'diff', path: rel, staged, untracked, context, ...diffPayload(d),
    });
  }

  /** Diff for a local change: unstaged = index ↔ working copy, staged = HEAD ↔ index. */
  /** A commit against the working tree, all files in one multi-file diff. */
  private async compareLocal(repo: Repository, hash: string) {
    const short = hash.slice(0, 7);
    const files = await this.service()!.changedSince(hash);
    if (!files.length) { void vscode.window.showInformationMessage(t('compareNone', short)); return; }
    const resources = files.map(f => {
      const uri = vscode.Uri.joinPath(repo.rootUri, f.path);
      const { left, right } = compareRefs(hash, f.status);
      return [uri, this.git.toGitUri(uri, left), right === undefined ? uri : this.git.toGitUri(uri, right)];
    });
    await vscode.commands.executeCommand('vscode.changes', t('compareTitle', short), resources);
  }

  private async openChange(repo: Repository, rel: string, staged: boolean) {
    const c = findChange(repo, rel, staged);
    if (!c) return;
    const name = path.basename(c.uri.fsPath);
    const view = changeView(c.status, staged);
    if ('open' in view) { await vscode.commands.executeCommand('vscode.open', c.uri); return; } // conflicts: VS Code offers the merge editor there
    const side = (x: DiffSide) => {
      const uri = x.file === 'original' ? c.originalUri : c.uri;
      return x.ref === undefined ? uri : this.git.toGitUri(uri, x.ref);
    };
    await vscode.commands.executeCommand('vscode.diff', side(view.left), side(view.right), t(view.title, name), { preview: true });
  }

  private withProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
    return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, fn));
  }

  private post(msg: ToWebview) {
    this.panel.webview.postMessage(msg);
  }

  // ---------- HTML ----------

  private html(media: vscode.Uri): string {
    const w = this.panel.webview;
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const css = w.asWebviewUri(vscode.Uri.joinPath(media, 'main.css'));
    const uri = (file: string) => String(w.asWebviewUri(vscode.Uri.joinPath(media, file)));
    return /* html */ `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${nonce}';${this.gravatar ? ' img-src https://gravatar.com https://*.gravatar.com;' : ''}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body>
  <header class="toolbar">
    <span class="repo-pick"><span class="ico" data-icon="repo"></span><select id="repo" title="${t('repository')}"></select></span>
    <span class="sep"></span>
    <button data-action="fetch" title="${t('fetchTip')}"><span class="ico" data-icon="fetch"></span>Fetch</button>
    <button data-action="pull" title="Pull"><span class="ico" data-icon="pull"></span>Pull<span class="badge" id="behind"></span></button>
    <button data-action="push" title="Push"><span class="ico" data-icon="push"></span>Push<span class="badge" id="ahead"></span></button>
    <span class="sep"></span>
    <button data-action="branch" title="${t('newBranch')}"><span class="ico" data-icon="branch"></span>Branch</button>
    <span class="split">
      <button data-action="stash" title="${t('stashTip')}"><span class="ico" data-icon="stash"></span>Stash</button><button id="stash-menu" class="chev" title="${t('stashMenuTip')}"><span class="ico" data-icon="chevDown"></span></button>
    </span>
    <span class="grow"></span>
    <button id="activity" title="${t('activityTip')}"><span class="ico" data-icon="history"></span>${t('activity')}</button>
    <button id="refresh" title="${t('refresh')}"><span class="ico" data-icon="refresh"></span>${t('refresh')}</button>
    <input id="filter" type="search" placeholder="${t('filterCommits')}" title="${t('filterCommitsTip')}">
  </header>
  <div id="mergebar" hidden></div>
  <main>
    <aside id="sidebar">
      <nav id="nav">
        <div class="nav-item" data-view="changes"><span class="ico" data-icon="changes"></span>${t('navChanges')}<span class="count" id="changes-count"></span></div>
        <div class="nav-item active" data-view="graph"><span class="ico" data-icon="commits"></span>${t('navCommits')}</div>
      </nav>
      <input id="ref-filter" type="search" placeholder="${t('filterRefs')}">
      <div id="refs"></div>
    </aside>
    <div class="splitter"></div>
    <section id="center">
      <div id="graph-view" class="view">
        <div id="list" tabindex="0"><div id="spacer"></div><div id="rows"></div></div>
        <div class="hsplitter"></div>
        <div id="details" class="empty">${t('selectCommit')}</div>
      </div>
      <div id="changes-view" class="view" hidden>
        <div class="cleft">
          <div class="clists">
            <div class="clist" id="unstaged" tabindex="0">
              <div class="chead"><span class="title">Unstaged</span><span class="count"></span><span class="grow"></span>
                <button data-bulk="stage" disabled>${t('stage')} ↓</button></div>
              <ul></ul>
            </div>
            <div class="clist" id="staged" tabindex="0">
              <div class="chead"><span class="title">Staged</span><span class="count"></span><span class="grow"></span>
                <button data-bulk="unstage" disabled>↑ ${t('unstage')}</button></div>
              <ul></ul>
            </div>
          </div>
        </div>
        <div class="vsplitter"></div>
        <div class="cright">
          <div id="diff" class="empty">${t('selectFile')}</div>
          <div class="commit-box">
            <div class="srow">
              <input id="c-subject" type="text" placeholder="${t('commitSubject')}" maxlength="200">
              <button id="c-recent" title="${t('recentTip')}" aria-label="${t('recentTip')}"><span data-icon="list"></span></button>
            </div>
            <textarea id="c-body" placeholder="${t('commitBody')}" rows="4"></textarea>
            <div class="crow">
              <label><input id="c-amend" type="checkbox"> Amend</label>
              <span class="grow"></span>
              <span id="c-len"></span>
              <button id="c-commit" class="primary">Commit</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <div id="activity-pop" hidden></div>
  <div id="mergedlg" hidden></div>
  <div id="stashdlg" hidden></div>
  <div id="pushdlg" hidden></div>
  <div id="menu" hidden></div>
  <div id="error" hidden></div>
  <script type="application/json" id="i18n">${JSON.stringify({ ...strings, _lang: lang }).replace(/</g, '\\u003c')}</script>
${scriptTags(MAIN_SCRIPTS, nonce, uri)}
</body>
</html>`;
  }

  dispose() {
    BonsaiPanel.current = undefined;
    clearTimeout(this.refreshTimer);
    this.stateListener?.dispose();
    this.repoListeners.forEach(d => d.dispose());
    this.disposables.forEach(d => d.dispose());
  }
}
