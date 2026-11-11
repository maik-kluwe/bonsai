import { REBASE_SCRIPTS, scriptTags } from './webviewAssets';
import { Status, type Repository } from './git';
import type { GitService } from './gitService';
import { planEntries, type Choice } from './interactiveRebase';
import { lang, strings } from './i18n';
import { finish } from './flows';
import type { Ui } from './ui';

/** The page of the interactive rebase dialog. Like the main page it knows nothing of VS Code, so the tests can build it. */
export function rebasePageHtml(o: { nonce: string; cspSource: string; css: string; uri: (file: string) => string }): string {
  return /* html */ `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource}; script-src 'nonce-${o.nonce}';">
<link rel="stylesheet" href="${o.css}">
</head>
<body>
  <h1 id="title"></h1>
  <p id="help"></p>
  <div id="rows"></div>
  <footer>
    <label><input type="checkbox" id="autostash"><span id="autostash-label"></span></label>
    <span id="error"></span>
    <button id="cancel"></button>
    <button id="start"></button>
  </footer>
${scriptTags(REBASE_SCRIPTS, o.nonce, o.uri)}
</body>
</html>`;
}

/** The texts the dialog's script needs; it has no access to the translations of the host. */
export const rebaseTexts = (): Record<string, string> =>
  Object.fromEntries(Object.entries(strings).filter(([k]) => k.startsWith('ir') || k === 'optAutostash'));

/** Local changes that a rebase would trip over: everything except untracked files. */
export const hasTrackedChanges = (repo: Repository): boolean => {
  const s = repo.state;
  return [...s.indexChanges, ...s.workingTreeChanges, ...s.mergeChanges].some(c => c.status !== Status.UNTRACKED);
};

/** What the dialog is about, and what its answers may touch. */
export interface RebaseDialog {
  range: Awaited<ReturnType<GitService['rebaseRange']>>;
  svc: GitService;
  repo: Repository;
  ui: Ui;
  /** wraps the rebase itself, so the caller can log it: the dialog outlives the message that opened it */
  track: <T>(run: () => Promise<T>) => Promise<T>;
  post(msg: unknown): void | Thenable<unknown>;
  close(): void;
}

/** The host's side of the dialog: what it does with a message of the page. */
export async function answerRebase(m: { type: string; entries?: Choice[]; autostash?: boolean }, d: RebaseDialog): Promise<void> {
  if (m.type === 'ready') {
    await d.post({ type: 'init', t: rebaseTexts(), branch: d.repo.state.HEAD?.name ?? 'HEAD', dirty: hasTrackedChanges(d.repo), commits: d.range.commits });
  } else if (m.type === 'cancel') {
    d.close();
  } else if (m.type === 'start') {
    const entries = planEntries(d.range.commits, m.entries ?? []);
    d.close();
    await finish(d.ui, d.repo, await d.track(() => d.svc.interactiveRebase(d.range.base, entries, { autostash: !!m.autostash })));
  }
}
