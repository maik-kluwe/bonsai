import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { GitService } from '../gitService';
import type { Repository } from '../git';

/** Temporary git repo for integration tests; `svc` is the extension's GitService on this repo. */
export class TestRepo {
  readonly dir: string;
  readonly svc: GitService;
  /** Each commit gets its own minute, otherwise ties make the log order arbitrary. */
  private clock = Date.UTC(2026, 0, 1, 10, 0, 0);

  constructor(opts: { autocrlf?: 'true' | 'false' | 'input' } = {}) {
    this.dir = mkdtempSync(path.join(tmpdir(), 'bonsai-test-'));
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'user.name', 'Test');
    this.git('config', 'core.autocrlf', opts.autocrlf ?? 'false');
    this.git('config', 'commit.gpgsign', 'false');
    this.svc = new GitService('git', { rootUri: { fsPath: this.dir } } as unknown as Repository);
  }

  private env() {
    const date = new Date(this.clock).toISOString();
    return { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, LC_ALL: 'C' };
  }

  /** Run git; throws on error. */
  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8', env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
  }

  /** Run git without throwing on errors (e.g. `merge` with a conflict exits with code 1). */
  tryGit(...args: string[]): { code: number | null; out: string } {
    const r = spawnSync('git', args, { cwd: this.dir, encoding: 'utf8', env: this.env() });
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
  }

  write(rel: string, content: string | Buffer): void {
    const abs = path.join(this.dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  /** Stage everything and commit; returns the commit hash. */
  commit(message: string, ...extra: string[]): string {
    this.clock += 60_000;
    this.git('add', '-A');
    this.git(...extra, 'commit', '-q', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD').trim();
  }

  /** Write a file and commit. */
  commitFile(rel: string, content: string | Buffer, message = `edit ${rel}`): string {
    this.write(rel, content);
    return this.commit(message);
  }

  /** Create a stash; also possible without -u. The tick gives it its own timestamp. */
  stash(message: string, untracked = false): void {
    this.clock += 60_000;
    this.git('stash', 'push', '-q', ...(untracked ? ['-u'] : []), '-m', message);
  }

  status(): string[] {
    return this.git('status', '--porcelain').split('\n').filter(Boolean);
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export const lines = (n: number, eol = '\n') => Array.from({ length: n }, (_, i) => String(i + 1)).join(eol) + eol;
