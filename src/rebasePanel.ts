import * as vscode from 'vscode';
import type { Repository } from './git';
import type { GitService } from './gitService';
import { answerRebase, rebasePageHtml } from './rebaseDialog';
import { t } from './i18n';
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

  const branch = repo.state.HEAD?.name ?? 'HEAD';
  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel('bonsaiRebase', t('irTitle', branch), vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [media],
  });
  panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg');
  const w = panel.webview;
  const uri = (name: string) => String(w.asWebviewUri(vscode.Uri.joinPath(media, name)));
  w.html = rebasePageHtml({ nonce: Math.random().toString(36).slice(2) + Date.now().toString(36), cspSource: w.cspSource, css: uri('rebasedlg.css'), uri });

  const dialog = { range, svc, repo, ui: vscodeUi, track, post: (msg: unknown) => w.postMessage(msg), close: () => panel.dispose() };
  const subscription = w.onDidReceiveMessage(async (m: { type: string }) => {
    try {
      await answerRebase(m, dialog);
    } catch (e) {
      void vscode.window.showErrorMessage(String((e as Error).message ?? e));
    }
  });
  panel.onDidDispose(() => subscription.dispose());
}
