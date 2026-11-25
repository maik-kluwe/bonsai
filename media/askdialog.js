// The window for a question of the host: a yes with a button, a text, one or several entries of a list. Runs in the
// webview (window.BonsaiAskDialog) and in the tests; main.js puts the HTML on the page and reads the fields.
(function (root) {
  /** A list longer than this gets a filter field. */
  const FILTER_FROM = 9;

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, post: (m: any) => void }} deps
   *   t translates a text key; esc escapes for HTML; post sends a message to the host
   */
  function createAskDialog({ t, esc, post }) {
    /** @type {{ id: number, q: any } | null} */
    let asked = null;

    /** Sends the answer to the open question; without one it is cancelled. */
    function send(/** @type {string | number[] | undefined} */ value) {
      if (!asked) return;
      post({ type: 'answer', id: asked.id, value });
      asked = null;
    }

    const item = (/** @type {any} */ it, /** @type {number} */ i, /** @type {boolean} */ one, /** @type {boolean} */ on) =>
      `<label class="aitem"><input type="${one ? 'radio' : 'checkbox'}" name="ask" data-i="${i}"${on ? ' checked' : ''}><span class="atext">`
      + `<span class="alabel">${esc(it.label)}${it.description ? ` <span class="pnote">${esc(it.description)}</span>` : ''}</span>`
      + `${it.detail ? `<span class="adetail">${esc(it.detail)}</span>` : ''}</span></label>`;

    function body(/** @type {any} */ q) {
      if (q.kind === 'input') return `<input type="text" class="smsg" id="ainput" value="${esc(q.value ?? '')}">`;
      if (q.kind === 'buttons') return q.detail ? `<div class="phint warn">${esc(q.detail)}</div>` : '';
      const one = q.kind === 'one';
      const facts = (q.facts ?? []).map((/** @type {string[]} */ [name, value]) => `<span>${esc(name)}</span><b>${esc(value)}</b>`).join('');
      // A window with facts is about a thing, and its hint describes it: on top. Otherwise the hint is about the choice.
      const hint = q.hint ? `<div class="${facts ? 'shint' : 'phint'}">${esc(q.hint)}</div>` : '';
      return `${facts ? `${hint}<div class="pform afacts">${facts}</div>` : ''}`
        + `${q.items.length >= FILTER_FROM ? `<input type="search" class="smsg" id="afilter" placeholder="${t('filterList')}">` : ''}`
        + `<div class="alist">${q.items.map((/** @type {any} */ it, /** @type {number} */ i) => item(it, i, one, one ? i === 0 : !!it.picked)).join('')}</div>`
        + `${facts ? '' : hint}`;
    }

    return {
      get isOpen() { return asked !== null; },
      get kind() { return asked?.q.kind; },

      open(/** @type {number} */ id, /** @type {any} */ question) { asked = { id, q: question }; },

      /**
       * The main button, or the n-th of several. `text` is the field's value, `picked` the ticked entries; a list of
       * which one has to be chosen is not answered without one.
       * @param {{ button?: number, text?: string, picked?: number[] }} fields
       */
      submit({ button = 0, text = '', picked = [] }) {
        if (!asked) return false;
        const { kind } = asked.q;
        if (kind === 'one' && !picked.length) return false;
        send(kind === 'buttons' ? [button] : kind === 'input' ? text : picked);
        return true;
      },

      cancel() { send(undefined); },

      html() {
        if (!asked) return '';
        const q = asked.q;
        const title = q.kind === 'buttons' || q.kind === 'input' ? q.message : q.title;
        const buttons = q.kind === 'buttons' ? q.buttons : [q.action ?? 'OK'];
        return `<div class="sdlg adlg">
      <div class="mhead"><b>${esc(title)}</b><span class="grow"></span><button data-askact="close" title="${t('cancel')}">✕</button></div>
      ${body(q)}
      <div class="mfoot"><span class="grow"></span>
        ${buttons.map((/** @type {string} */ b, /** @type {number} */ i) => `<button${i ? '' : ' class="primary"'} data-askact="ok" data-n="${i}">${esc(b)}</button>`).join('')}<button data-askact="close">${t('cancel')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createAskDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiAskDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
