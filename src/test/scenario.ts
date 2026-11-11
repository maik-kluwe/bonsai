import { execFileSync } from 'child_process';
import { AsyncLocalStorage } from 'async_hooks';
import { ActivityLog, ActivityRecorder, describeAction, formatCommand, isWriteCommand } from '../activityLog';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import type { FetchOptions, Repository } from '../git';
import { handleRepoMessage, isRepoMessage, READ_ONLY_TYPES } from '../messages';
import { readLocalDiff, readSnapshot } from '../readSnapshot';
import type { ToHost, ToWebview } from '../protocol';
import { WebviewPage } from './dom';
import { FlowHarness } from './flowHarness';
import { lines } from './helpers';

/**
 * The whole path of a user action without VS Code: the real view (jsdom) posts a message, the real handlers run it
 * against a real temporary repository, and the answer, a fresh snapshot among it, goes back into the view.
 * What this leaves out is `panel.ts` itself (the Git extension's API, VS Code's own dialogs, the caches): the smoke
 * tests in the real VS Code cover that.
 */
export class Scenario {
  readonly h = new FlowHarness();
  readonly page: WebviewPage;
  /** Messages of the view that only the window itself would answer: copy, open an editor and so on. */
  readonly windowMessages: ToHost[] = [];
  private pending: Promise<void>[] = [];
  /** What the panel keeps of this session, and the action that is running: the same parts, put together as in panel.ts. */
  private readonly activity = new ActivityLog();
  private readonly current = new AsyncLocalStorage<ActivityRecorder | undefined>();
  private readonly extra: string[] = [];

  /** How many commits the view has asked for; `loadMore` raises it by `step`, as the panel does with `bonsai.maxCommits`. */
  limit: number;
  private readonly step: number;

  constructor(opts: { logLimit?: number } = {}) {
    this.limit = this.step = opts.logLimit ?? 1000;
    this.h.trace = (args, stdout, stderr, ok) => {
      if (!isWriteCommand(args)) return;
      this.current.getStore()?.commands.push({ command: formatCommand(args), output: [stdout, stderr].filter(x => x.trim()).join('\n'), ok });
    };
    this.page = new WebviewPage(m => this.pending.push(this.receive(m)));
    // A conflict dialog reaches the view as a message, as in the panel
    const conflicts = this.h.ui.conflicts.bind(this.h.ui);
    this.h.ui.conflicts = async (output, files) => { await conflicts(output, files); this.page.send({ type: 'conflicts', files, output }); };
  }

  private send(m: ToWebview) { this.h.posted.push(m); this.page.send(m); }

  private async snapshot() { this.send(await readSnapshot(this.h.svc, this.h.repo as unknown as Repository, this.limit)); }

  /** What the panel does with a message of the view. */
  private async receive(m: ToHost): Promise<void> {
    await null; // the view says `ready` while it is still being built, before `page` is assigned
    const desc = describeAction(m);
    if (!desc) return this.handle(m);
    const rec = new ActivityRecorder();
    try {
      await this.current.run(rec, () => this.handle(m, rec));
    } finally {
      if (this.activity.record(desc, path.basename(this.h.t.dir), rec)) this.send({ type: 'activity', entries: this.activity.entries });
    }
  }

  private async handle(m: ToHost, rec?: ActivityRecorder): Promise<void> {
    try {
      if (m.type === 'ready') {
        this.send({ type: 'repos', repos: [{ root: this.h.t.dir, name: path.basename(this.h.t.dir) }], selected: this.h.t.dir });
        await this.snapshot();
      } else if (m.type === 'refresh' || m.type === 'loadMore') {
        if (m.type === 'loadMore') this.limit += this.step;
        await this.h.repo.status();
        await this.snapshot();
      } else if (m.type === 'loadDiff') {
        const merge = await this.h.svc.mergeState();
        this.send(await readLocalDiff(this.h.svc, this.h.repo as unknown as Repository, m.path, m.staged, m.context, merge?.hash));
      } else if (isRepoMessage(m)) {
        const api = <T>(call: Promise<T>): Promise<T> => { if (rec) rec.api = true; return call; };
        await handleRepoMessage(m, { ...this.h.ctx, api, post: msg => this.send(msg) });
        if (!READ_ONLY_TYPES.includes(m.type)) { await this.h.repo.status(); await this.snapshot(); }
      } else if (m.type === 'activity') {
        this.send({ type: 'activity', entries: this.activity.entries });
      } else {
        this.windowMessages.push(m);
      }
    } catch (e) {
      if (rec) rec.error ??= String((e as Error).message ?? e);
      this.h.ui.errors.push(String((e as Error).message ?? e));
    }
  }

  /** Wait until the host has answered everything the view posted, and what that set off in turn. */
  async settle(): Promise<void> {
    while (this.pending.length) await this.pending.shift();
  }

  /** The view has started (it asks for its data on its own) and the host has answered. */
  async open(): Promise<this> {
    await this.settle();
    return this;
  }

  /** Typing into a field, and the host's answer to it. */
  async type(selector: string, value: string): Promise<void> {
    this.page.type(selector, value);
    await this.settle();
  }

  /** A key in a field, and the host's answer to it. */
  async key(selector: string, key: string, init: KeyboardEventInit = {}): Promise<void> {
    this.page.key(selector, key, init);
    await this.settle();
  }

  /** A right click, and the host's answer to it. */
  async rightClick(selector: string): Promise<void> {
    this.page.rightClick(selector);
    await this.settle();
  }

  /** Drag one element onto another, and the host's answer to it. */
  async drag(from: string, onto: string): Promise<void> {
    this.page.drag(from, onto);
    await this.settle();
  }

  /** The entries of the context menu that is open. */
  menuEntries(): string[] {
    return [...this.page.document.querySelectorAll('#menu .mi')].map(e => (e.textContent ?? '').trim());
  }

  /** Click the entry of the open context menu whose text matches. */
  async menu(label: RegExp): Promise<void> {
    const entry = [...this.page.document.querySelectorAll<HTMLElement>('#menu .mi')].find(e => label.test(e.textContent ?? ''));
    if (!entry) throw new Error(`no menu entry ${label}; the menu has: ${this.menuEntries().join(' | ')}`);
    await this.click(`#menu .mi[data-i="${entry.dataset.i}"]`);
  }

  /** Right click on something and choose an entry of its menu. */
  async rightClickAndChoose(selector: string, label: RegExp): Promise<void> {
    await this.rightClick(selector);
    await this.menu(label);
  }

  /** A click, and the host's answer to it. */
  async click(selector: string, init: MouseEventInit = {}): Promise<void> {
    this.page.click(selector, init);
    await this.settle();
  }

  /**
   * Give the work repository a server and a colleague who pushes. The work repository starts on main with a.txt and
   * b.txt (30 lines each), both pushed.
   */
  withServer(): this {
    const { t, repo } = this.h;
    const server = mkdtempSync(path.join(tmpdir(), 'bonsai-server-'));
    const colleague = mkdtempSync(path.join(tmpdir(), 'bonsai-colleague-'));
    this.extra.push(server, colleague);
    execFileSync('git', ['-C', server, 'init', '-q', '--bare', '-b', 'main']);
    t.git('remote', 'add', 'origin', server);
    t.write('a.txt', lines(30));
    t.write('b.txt', lines(30));
    t.commit('base');
    t.git('push', '-q', '-u', 'origin', 'main');
    execFileSync('git', ['clone', '-q', server, colleague], { stdio: 'ignore' });
    for (const [k, v] of [['user.email', 'colleague@example.com'], ['user.name', 'Colleague'], ['commit.gpgsign', 'false']]) {
      execFileSync('git', ['-C', colleague, 'config', k, v]);
    }
    this.colleagueDir = colleague;
    this.serverDir = server;
    repo.state.remotes = [{ name: 'origin' }];
    void repo.status(); // the fake only learns the branch name now that there is a commit
    // What the Git extension's fetch does with the options the flows pass
    repo.fetch = (async (o?: FetchOptions) => {
      t.git('fetch', '-q', ...(o?.all ? ['--all'] : o?.remote ? [o.remote] : []), ...(o?.prune ? ['--prune'] : []));
    }) as typeof repo.fetch;
    return this;
  }

  private colleagueDir = '';
  /** The bare repository that plays the server. */
  serverDir = '';

  /** A Git command in the server. */
  server(...args: string[]): string {
    return execFileSync('git', ['-C', this.serverDir, ...args], { encoding: 'utf8' }).trim();
  }

  /** The colleague changes one line of a file and pushes. */
  colleaguePushes(file: string, line: number, text: string): void {
    const rows = lines(30).split('\n');
    rows[line - 1] = text;
    writeFileSync(path.join(this.colleagueDir, file), rows.join('\n'));
    const git = (...a: string[]) => execFileSync('git', ['-C', this.colleagueDir, ...a], { stdio: 'ignore' });
    git('commit', '-q', '-am', `colleague changes ${file}`);
    git('push', '-q', 'origin', 'main');
  }

  /** A local change to one line of a tracked file, not committed. */
  editLocally(file: string, line: number, text: string): void {
    const rows = lines(30).split('\n');
    rows[line - 1] = text;
    this.h.t.write(file, rows.join('\n'));
  }

  dispose(): void {
    this.page.close();
    this.h.dispose();
    for (const d of this.extra) rmSync(d, { recursive: true, force: true });
  }
}
