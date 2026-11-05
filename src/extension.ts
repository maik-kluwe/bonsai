import * as vscode from 'vscode';
import type { API, GitExtension } from './git';
import { BonsaiPanel } from './panel';
import { t } from './i18n';

export async function activate(ctx: vscode.ExtensionContext) {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  const gitExt = ext && (ext.isActive ? ext.exports : await ext.activate());
  if (!gitExt?.enabled) {
    vscode.window.showWarningMessage(t('gitDisabled'));
    return;
  }
  const git: API = gitExt.getAPI(1);

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = '$(git-merge) Bonsai';
  statusItem.tooltip = t('openBonsaiTip');
  statusItem.command = 'bonsai.open';
  statusItem.show();

  ctx.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('bonsai.open', () => BonsaiPanel.show(ctx, git)),
    { dispose: () => BonsaiPanel.current?.dispose() },
  );
}

export function deactivate() {}
