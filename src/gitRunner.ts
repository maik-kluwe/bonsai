import { execFile } from 'child_process';

/** Called after every Git command with what it printed (the activity log picks the ones that change something). */
export type Trace = (args: string[], stdout: string, stderr: string, ok: boolean) => void;

/**
 * The one way Bonsai starts Git. Every command, text or binary, goes through here so that the trace sees all of
 * them; the activity log relies on that.
 */
export class GitRunner {
  constructor(
    private readonly gitPath: string,
    readonly root: string,
    private readonly trace?: Trace,
  ) {}

  /**
   * @param stdin  passed to git (e.g. patch for `git apply -`)
   * @param okCodes additional exit codes that are not errors (`diff --no-index` returns 1 on differences)
   * @param env    set on top of the environment of the extension host
   */
  async run(args: string[], stdin?: string, okCodes: number[] = [], env?: NodeJS.ProcessEnv): Promise<string> {
    return (await this.runOutput(args, stdin, okCodes, env)).stdout;
  }

  /** Like `run`, for commands that report on stderr even when they succeed (`git push`). */
  runOutput(args: string[], stdin?: string, okCodes: number[] = [], env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(this.gitPath, args, { cwd: this.root, maxBuffer: 64 * 1024 * 1024, ...(env && { env: { ...process.env, ...env } }) }, (err, stdout, stderr) => {
        const code = (err as NodeJS.ErrnoException & { code?: unknown })?.code;
        const failed = !!err && !(typeof code === 'number' && okCodes.includes(code));
        this.trace?.(args, stdout, stderr, !failed);
        if (failed) reject(Object.assign(new Error(stderr.trim() || err!.message), { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
      if (stdin !== undefined) child.stdin?.end(stdin);
    });
  }

  /** Raw stdout for content that is not necessarily text (`git show :2:file`); undefined if Git fails. */
  runBinary(args: string[]): Promise<Buffer | undefined> {
    return new Promise(resolve => execFile(this.gitPath, args,
      { cwd: this.root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        this.trace?.(args, '', stderr.toString(), !err);
        resolve(err ? undefined : stdout);
      }));
  }
}
