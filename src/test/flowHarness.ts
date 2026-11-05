import * as path from 'path';
import { Status, type Change, type Repository } from '../git';
import { GitService } from '../gitService';
import type { MessageCtx } from '../messages';
import type { ToWebview } from '../protocol';
import type { PickItem, Ui } from '../ui';
import { TestRepo } from './helpers';

/** A Ui that answers from fields instead of asking, and notes what it was asked. */
export class ScriptedUi implements Ui {
  /** One line per question: `confirm: <message>`, `choose: <message>`, … */
  asked: string[] = [];
  informed: { message: string; detail: string }[] = [];
  errors: string[] = [];
  /** The labels of the items of the last pick or pickMany, or the buttons of the last choose. */
  offered: string[] = [];
  /** The detail of the last confirm or choose. */
  detail: string | undefined;
  confirmAnswer = true;
  chooseAnswer: (buttons: string[]) => string | undefined = b => b[0];
  inputAnswer: string | undefined = 'answer';
  saveAnswer: string | undefined;
  pickAnswer: (items: PickItem[]) => PickItem | undefined = items => items[0];
  /** Default: the boxes as they come pre-ticked. */
  pickManyAnswer: (items: PickItem[]) => PickItem[] | undefined = items => items.filter(i => i.picked);

  async confirm(message: string, action: string, detail?: string) {
    this.asked.push(`confirm: ${message}`);
    void action;
    this.detail = detail;
    return this.confirmAnswer;
  }
  async choose(message: string, buttons: string[], detail?: string) {
    this.asked.push(`choose: ${message}`);
    this.offered = buttons;
    this.detail = detail;
    return this.chooseAnswer(buttons);
  }
  async inform(message: string, detail: string) {
    this.asked.push(`inform: ${message}`);
    this.informed.push({ message, detail });
  }
  error(message: string) { this.errors.push(message); }
  async saveFile(defaultPath: string) {
    this.asked.push(`save: ${defaultPath}`);
    return this.saveAnswer;
  }
  async input(prompt: string) {
    this.asked.push(`input: ${prompt}`);
    return this.inputAnswer;
  }
  async pick<T extends PickItem>(items: T[]) {
    this.asked.push('pick');
    this.offered = items.map(i => i.label);
    return this.pickAnswer(items) as T | undefined;
  }
  async pickMany<T extends PickItem>(items: T[]) {
    this.asked.push('pickMany');
    this.offered = items.map(i => i.label);
    return this.pickManyAnswer(items) as T[] | undefined;
  }
}

const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * The part of VS Code's Repository the flows use, backed by the real repository in `t`. `state` is read from
 * `git status` whenever `status()` runs, as the Git extension does.
 */
export class FakeRepo {
  readonly rootUri: { fsPath: string };
  state = { HEAD: undefined as { name?: string; upstream?: unknown } | undefined, remotes: [] as { name: string }[],
    indexChanges: [] as Change[], workingTreeChanges: [] as Change[], mergeChanges: [] as Change[], untrackedChanges: [] as Change[] };

  constructor(private readonly t: TestRepo) {
    this.rootUri = { fsPath: t.dir };
    this.refreshSync();
  }

  private change(rel: string, status: Status): Change {
    const uri = { fsPath: path.join(this.t.dir, rel) };
    return { uri, originalUri: uri, renameUri: undefined, status } as unknown as Change;
  }

  private refreshSync() {
    const s = this.state;
    s.indexChanges = []; s.workingTreeChanges = []; s.mergeChanges = []; s.untrackedChanges = [];
    const branch = this.t.tryGit('rev-parse', '--abbrev-ref', 'HEAD');
    s.HEAD = { name: branch.code === 0 ? branch.out.trim() : undefined };
    for (const line of this.t.git('status', '--porcelain').split('\n').filter(Boolean)) {
      const xy = line.slice(0, 2), rel = line.slice(3);
      if (xy === '??') s.untrackedChanges.push(this.change(rel, Status.UNTRACKED));
      else if (UNMERGED.has(xy)) s.mergeChanges.push(this.change(rel, Status.BOTH_MODIFIED));
      else {
        if (xy[0] !== ' ') s.indexChanges.push(this.change(rel, xy[0] === 'A' ? Status.INDEX_ADDED : xy[0] === 'D' ? Status.INDEX_DELETED : Status.INDEX_MODIFIED));
        if (xy[1] !== ' ') s.workingTreeChanges.push(this.change(rel, xy[1] === 'D' ? Status.DELETED : Status.MODIFIED));
      }
    }
  }

  async status() { this.refreshSync(); }
  async add(paths: string[]) { this.t.git('add', '--', ...paths); this.refreshSync(); }
  async revert(paths: string[]) { this.t.git('reset', '-q', '--', ...paths); this.refreshSync(); }
  async clean(paths: string[]) {
    for (const p of paths) {
      if (this.t.tryGit('ls-files', '--error-unmatch', '--', p).code === 0) this.t.git('checkout', '--', p);
      else this.t.git('clean', '-fdq', '--', p);
    }
    this.refreshSync();
  }
  async commit(message: string, opts?: { amend?: boolean }) {
    this.t.git('commit', '-q', ...(opts?.amend ? ['--amend'] : []), '-m', message);
    this.refreshSync();
  }
  async checkout(ref: string) { this.t.git('checkout', '-q', ref); this.refreshSync(); }
  async createBranch(name: string, checkout: boolean, ref?: string) {
    this.t.git(...(checkout ? ['checkout', '-q', '-b', name] : ['branch', name]), ...(ref ? [ref] : []));
    this.refreshSync();
  }
  async createStash(o?: { message?: string; includeUntracked?: boolean }) {
    this.t.git('stash', 'push', '-q', ...(o?.includeUntracked ? ['-u'] : []), ...(o?.message ? ['-m', o.message] : []));
    this.refreshSync();
  }
  async dropStash(index = 0) { this.t.git('stash', 'drop', '-q', `stash@{${index}}`); }
  fetch = async () => undefined;
  pull = async () => undefined;
  push = async () => undefined;
}

/** A temporary repository with everything a flow needs: service, repository, scripted dialogs, a recorder for replies. */
export class FlowHarness {
  readonly t = new TestRepo();
  readonly repo = new FakeRepo(this.t);
  readonly ui = new ScriptedUi();
  readonly svc = new GitService('git', this.repo as unknown as Repository);
  readonly posted: ToWebview[] = [];
  /** How many calls went through the Git extension API wrapper. */
  apiCalls = 0;

  get ctx(): MessageCtx {
    return {
      ui: this.ui, svc: this.svc, repo: this.repo as unknown as Repository,
      api: call => { this.apiCalls++; return call; },
      progress: (_title, fn) => fn(),
      post: m => { this.posted.push(m); },
    };
  }

  dispose() { this.t.dispose(); }
}
