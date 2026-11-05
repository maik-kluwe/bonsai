import * as vscode from 'vscode';

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
  /** Modal notice that only informs (what Git printed on conflicts). */
  inform(message: string, detail: string): Promise<void>;
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
  async inform(message, detail) {
    await vscode.window.showWarningMessage(message, { modal: true, detail });
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
