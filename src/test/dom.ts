import { readFileSync } from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { pageHtml } from '../pageHtml';
import { rebasePageHtml } from '../rebaseDialog';
import { MAIN_SCRIPTS, REBASE_SCRIPTS } from '../webviewAssets';
import type { ToHost, ToWebview } from '../protocol';

const MEDIA = path.join(__dirname, '..', '..', 'media');

/**
 * The real main view in a DOM without a browser: the page of `pageHtml` and the scripts of media/, run as the webview runs them.
 * Nothing is laid out (every box is 0 px, except the window of the graph list), so it answers "what does the view say and do", not "how does it look".
 * `send` plays a message of the host, `sent` holds what the view posted back.
 */
export class WebviewPage {
  readonly dom: JSDOM;
  /** Messages the view posted to the host, oldest first. */
  readonly sent: ToHost[] = [];
  /** Errors the scripts threw; a test that cares looks here. */
  readonly errors: string[] = [];

  /**
   * @param onPost called for every message the view posts, as the host receives it
   * @param kind the main view, or the window of the interactive rebase (whose messages are not `ToHost`: read `sent` with care)
   */
  constructor(onPost?: (m: ToHost) => void, kind: 'main' | 'rebase' = 'main') {
    const markup = kind === 'main'
      ? pageHtml({ nonce: 'test', cspSource: 'vscode-resource:', css: 'main.css', uri: f => f, gravatar: false })
      : rebasePageHtml({ nonce: 'test', cspSource: 'vscode-resource:', css: 'rebasedlg.css', uri: f => f });
    this.dom = new JSDOM(
      markup.replace(/<script[^>]*src=[^>]*><\/script>/g, ''),
      { runScripts: 'outside-only', pretendToBeVisual: true },
    );
    const w = this.dom.window as unknown as Record<string, unknown> & Window;
    w.acquireVsCodeApi = () => ({ postMessage: (m: ToHost) => { const copy = JSON.parse(JSON.stringify(m)) as ToHost; this.sent.push(copy); onPost?.(copy); }, getState: () => undefined, setState: () => undefined });
    w.addEventListener('error', e => this.errors.push(String((e as ErrorEvent).error ?? (e as ErrorEvent).message)));
    // main.js leans on browser features jsdom does not have
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    this.dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    // A window to look through: 800 x 480 px, the graph as tall as its spacer says. Nothing else is laid out.
    const list = this.document.getElementById('list');
    if (list) Object.defineProperties(list, {
      clientWidth: { value: 800 }, clientHeight: { value: 480 },
      scrollHeight: { get: () => parseFloat(this.document.getElementById('spacer')!.style.height) || 0 },
    });
    for (const file of kind === 'main' ? MAIN_SCRIPTS : REBASE_SCRIPTS) {
      this.dom.window.eval(readFileSync(path.join(MEDIA, file), 'utf8'));
    }
  }

  get document(): Document { return this.dom.window.document; }

  /** The host sends a message; the view handles it synchronously. */
  send(msg: ToWebview | { type: string }): void {
    this.dom.window.dispatchEvent(new this.dom.window.MessageEvent('message', { data: msg }));
  }

  /** The element (typed with `$<HTMLInputElement>(…)` when the test needs its properties), or a clear failure: a selector that matches nothing is a mistake in the test, not a result. */
  $<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.document.querySelector<T>(selector);
    if (!el) throw new Error(`nothing matches ${selector}`);
    return el;
  }

  /** A click; `init.detail: 2` is the second click of a double click. */
  click(selector: string, init: MouseEventInit = {}): void {
    if (!Object.keys(init).length) { this.$(selector).click(); return; }
    this.$(selector).dispatchEvent(new this.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  }

  /** Set the value of a field and tell the view, as typing does. */
  type(selector: string, value: string): void {
    const el = this.$<HTMLInputElement>(selector);
    el.value = value;
    el.dispatchEvent(new this.dom.window.Event('input', { bubbles: true }));
  }

  key(selector: string, key: string, init: KeyboardEventInit = {}): void {
    this.$(selector).dispatchEvent(new this.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  }

  rightClick(selector: string): void {
    const el = this.$(selector);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new this.dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.top }));
  }

  /** Drag one element onto another: dragstart, dragover and drop, with the data transfer object the view looks at. */
  drag(from: string, onto: string): void {
    const transfer = { effectAllowed: 'none', dropEffect: 'none', data: {} as Record<string, string>, setData(k: string, v: string) { this.data[k] = v; }, getData(k: string) { return this.data[k] ?? ''; } };
    const fire = (el: HTMLElement, type: string) => {
      const e = new this.dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: transfer });
      Object.assign(e, { clientX: 10, clientY: 10 });
      el.dispatchEvent(e);
    };
    const source = this.$(from), target = this.$(onto);
    fire(source, 'dragstart');
    fire(target, 'dragover');
    fire(target, 'drop');
    fire(source, 'dragend');
  }

  /** The rows of the graph as text, in order. */
  rows(): string[] {
    return [...this.document.querySelectorAll('.row')].map(r => (r.textContent ?? '').replace(/\s+/g, ' ').trim());
  }

  /** The messages of one type that the view posted. */
  sentOf<T extends ToHost['type']>(type: T): Extract<ToHost, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ToHost, { type: T }> => m.type === type);
  }

  /** What a user would read: the visible text of an element, spaces folded. */
  text(selector: string): string {
    return (this.$(selector).textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  close(): void { this.dom.window.close(); }
}
