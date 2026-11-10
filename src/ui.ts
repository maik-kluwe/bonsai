import * as vscode from 'vscode';
import { t } from './i18n';

/** An entry of a pick list; the same shape VS Code's QuickPick takes. */
export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

/**
 * Everything the flows ask of the user. One adapter shows VS Code dialogs, another answers from a script in tests;
 * that is why the flows in flows.ts can run against a real Git repository without a window.
 */
export interface Ui {
  /** Modal question with one way to say yes (the button text). */
  confirm(message: string, action: string, detail?: string): Promise<boolean>;
  /** Modal question with several answers; the button pressed, or undefined if the dialog was dismissed. */
  choose(message: string, buttons: string[], detail?: string): Promise<string | undefined>;
  /** An operation stopped on conflicts: the files, and what Git printed. The banner in the panel takes over from there. */
  conflicts(output: string, files: string[]): Promise<void>;
  error(message: string): void;
  /** Text input; undefined if cancelled. */
  input(prompt: string, value?: string): Promise<string | undefined>;
  pick<T extends PickItem>(items: T[], o: { title: string; placeHolder?: string }): Promise<T | undefined>;
  pickMany<T extends PickItem>(items: T[], o: { title: string; placeHolder?: string }): Promise<T[] | undefined>;
  /** Save dialog starting at `defaultPath`; the chosen path, or undefined if cancelled. */
  saveFile(defaultPath: string): Promise<string | undefined>;
}

export const vscodeUi: Ui = {
  async confirm(message, action, detail) {
    return !!(await vscode.window.showWarningMessage(message, { modal: true, detail }, action));
  },
  choose(message, buttons, detail) {
    return Promise.resolve(vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons));
  },
  // The panel shows its own dialog (BonsaiPanel); this is for the windows that have none, such as the rebase plan
  async conflicts(output) {
    await vscode.window.showWarningMessage(t('conflictGitOutput'), { modal: true, detail: output });
  },
  error(message) {
    void vscode.window.showErrorMessage(message);
  },
  input(prompt, value) {
    return Promise.resolve(vscode.window.showInputBox({ prompt, value }));
  },
  pick(items, o) {
    return Promise.resolve(vscode.window.showQuickPick(items, o));
  },
  async pickMany(items, o) {
    const picks = await vscode.window.showQuickPick(items, { ...o, canPickMany: true });
    return picks && [...picks];
  },
  async saveFile(defaultPath) {
    return (await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath) }))?.fsPath;
  },
};
