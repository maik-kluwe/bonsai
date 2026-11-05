import { REBASE_SCRIPTS, scriptTags } from './webviewAssets';
import * as vscode from 'vscode';
import { Status, type Repository } from './git';
import type { GitService } from './gitService';
import { planEntries, type Choice } from './interactiveRebase';
import { lang, strings, t } from './i18n';
import { finish } from './flows';
import { vscodeUi } from './ui';

/**
 * Opens the dialog of an interactive rebase of the current branch over `range`. The dialog is a webview of its own: the choices per commit (action, order, new messages) do not fit a QuickPick.
 */
export async function openInteractiveRebase(
  extensionUri: vscode.Uri, svc: GitService, repo: Repository,
  range: Awaited<ReturnType<GitService['rebaseRange']>>,
  /** wraps the rebase itself, so the caller can log it: the dialog outlives the message that opened it */
  track: <T>(run: () => Promise<T>) => Promise<T>,
): Promise<void> {
  if (!range.onBranch) throw new Error(t('errIrNotOnBranch'));
  if (!range.commits.length) throw new Error(t('errIrNothing'));
  if (range.merges) throw new Error(t('errIrMerges'));

  const s = repo.state;
  const dirty = [...s.indexChanges, ...s.workingTreeChanges, ...s.mergeChanges].some(c => c.status !== Status.UNTRACKED);
  const branch = s.HEAD?.name ?? 'HEAD';

  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel('bonsaiRebase', t('irTitle', branch), vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [media],
  });
  panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg');
  const w = panel.webview;
  const uri = (name: string) => w.asWebviewUri(vscode.Uri.joinPath(media, name));
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  w.html = /* html */ `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${uri('rebasedlg.css')}">
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
${scriptTags(REBASE_SCRIPTS, nonce, f => String(uri(f)))}
</body>
</html>`;

  const texts = Object.fromEntries(Object.entries(strings).filter(([k]) => k.startsWith('ir') || k === 'optAutostash'));
  const subscription = w.onDidReceiveMessage(async (m: { type: string; entries?: Choice[]; autostash?: boolean }) => {
    try {
      if (m.type === 'ready') {
        await w.postMessage({ type: 'init', t: texts, branch, dirty, commits: range.commits });
      } else if (m.type === 'cancel') {
        panel.dispose();
      } else if (m.type === 'start') {
        const entries = planEntries(range.commits, m.entries ?? []);
        panel.dispose();
        await finish(vscodeUi, repo, await track(() => svc.interactiveRebase(range.base, entries, { autostash: !!m.autostash })));
      }
    } catch (e) {
      void vscode.window.showErrorMessage(String((e as Error).message ?? e));
    }
  });
  panel.onDidDispose(() => subscription.dispose());
}
