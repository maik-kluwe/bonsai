import type { Answer, Question, ToWebview } from './protocol';
import type { PickItem, PickOptions, Ui } from './ui';

/** The questions of `Ui` that Bonsai asks in its own windows. */
export type PromptUi = Pick<Ui, 'confirm' | 'choose' | 'input' | 'pick' | 'pickMany'>;

/**
 * Asks the user in the webview and waits for the answer. One question is open at a time; whatever ends it without an
 * answer (another question, a page that loads anew, a closed panel) counts as cancelled, so that no flow waits forever.
 */
export class Prompts {
  private id = 0;
  private waiting: ((value: Answer | undefined) => void) | undefined;

  constructor(private readonly post: (m: ToWebview) => void) {}

  /** A question waits for its answer. */
  get open(): boolean { return !!this.waiting; }

  ask(question: Question): Promise<Answer | undefined> {
    this.cancel();
    return new Promise(resolve => {
      this.waiting = resolve;
      this.post({ type: 'ask', id: ++this.id, question });
    });
  }

  /** The view's answer to question `id`; without a value the user cancelled. Late answers to older questions are dropped. */
  answer(id: number, value?: Answer): void {
    if (id !== this.id) return;
    const done = this.waiting;
    this.waiting = undefined;
    done?.(value);
  }

  /** Gives up on the open question, if any. */
  cancel(): void { this.answer(this.id); }

  readonly ui: PromptUi = {
    confirm: async (message, action, detail) => this.index(await this.ask({ kind: 'buttons', message, buttons: [action], detail }), 1) !== undefined,
    choose: async (message, buttons, detail) => {
      const i = this.index(await this.ask({ kind: 'buttons', message, buttons, detail }), buttons.length);
      return i === undefined ? undefined : buttons[i];
    },
    input: async (prompt, value) => {
      const answer = await this.ask({ kind: 'input', message: prompt, value });
      return typeof answer === 'string' ? answer : undefined;
    },
    pick: async <T extends PickItem>(items: T[], o: PickOptions) => {
      const i = this.index(await this.ask(list('one', items, o)), items.length);
      return i === undefined ? undefined : items[i];
    },
    pickMany: async <T extends PickItem>(items: T[], o: PickOptions) => {
      const answer = await this.ask(list('many', items, o));
      return Array.isArray(answer) ? items.filter((_, i) => answer.includes(i)) : undefined;
    },
  };

  /** The one index an answer holds, if it is one of `length` entries. */
  private index(answer: Answer | undefined, length: number): number | undefined {
    const i = Array.isArray(answer) ? answer[0] : undefined;
    return i !== undefined && Number.isInteger(i) && i >= 0 && i < length ? i : undefined;
  }
}

/** What the view needs of the items; the rest (modes, ids) stays here. */
const list = (kind: 'one' | 'many', items: PickItem[], o: PickOptions): Question => ({
  kind, title: o.title, hint: o.placeHolder, action: o.action, facts: o.facts,
  items: items.map(({ label, description, detail, picked }) => ({ label, description, detail, picked })),
});
