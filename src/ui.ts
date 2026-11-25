import * as vscode from 'vscode';
import { t } from './i18n';

/** An entry of a pick list; the same shape VS Code's QuickPick takes. */
export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

/** What a list is asked with. `action` and `facts` are shown by Bonsai's own window only. */
export interface PickOptions {
  title: string;
  placeHolder?: string;
  /** The text of the main button. */
  action?: string;
  /** Rows of name and value above the list. */
  facts?: [string, string][];
}

/**
 * Everything the flows ask of the user. The panel asks in windows of its own (prompts.ts), the windows without a view of
 * theirs use VS Code dialogs, and the tests answer from a script; that is why the flows in flows.ts can run against a real Git repository without a window.
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
  pick<T extends PickItem>(items: T[], o: PickOptions): Promise<T | undefined>;
  pickMany<T extends PickItem>(items: T[], o: PickOptions): Promise<T[] | undefined>;
  /** Save dialog starting at `defaultPath`; the chosen path, or undefined if cancelled. */
  saveFile(defaultPath: string): Promise<string | undefined>;
  /**
   * Opens the Output panel on `title` (emptied) for a command that takes a while and has something to say on the way,
   * such as a pre-push hook. The returned function adds text to it.
   */
  liveOutput(title: string): (text: string) => void;
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
  liveOutput(title) {
    const channel = outputChannel(title);
    channel.clear();
    channel.show(true); // the Bonsai panel keeps the focus
    return text => channel.append(text);
  },
};

const channels = new Map<string, vscode.OutputChannel>();
/** One channel per title for the whole session; a new one for every push would fill the list in the Output panel. */
function outputChannel(title: string): vscode.OutputChannel {
  let channel = channels.get(title);
  if (!channel) channels.set(title, channel = vscode.window.createOutputChannel(title));
  return channel;
}
