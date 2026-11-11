// The HTML of a diff: hunks as tables, with the buttons of a hunk, marked lines, and the signs for spaces, tabs and line
// ends. Runs in the webview (window.BonsaiDiffHtml) and in the tests; it only builds strings, main.js puts them on the page.
(function (root) {
  /** Escapes text for HTML. */
  const esc = (/** @type {string} */ s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, lineSel: { count(h: number): number, has(h: number, line: number): boolean }, images?: { html(images: any): string } }} deps
   *   t translates a text key; lineSel holds the marked lines (media/linesel.js); images draws a changed picture (media/imagediff.js)
   */
  function createDiffBody({ t, lineSel, images }) {
  /**
   * Hunks as a table; hunkBtns = buttons in the hunk header (empty for a read-only view). With `pickLines` the changed
   * lines can be marked, and a hunk with marked lines gets buttons for just those lines.
   */
  function diffBody(/** @type {any} */ m, /** @type {string} */ hunkBtns, /** @type {'stage' | 'unstage' | null} */ pickLines = null, /** @type {{ ws: boolean, eol: boolean } | null} */ look = null) {
    /** Code of a line; with look.ws spaces become dots and tabs arrows (a tab is padded to four columns). */
    const code = (/** @type {string} */ text, /** @type {boolean} */ noEol) => {
      const cr = text.endsWith('\r');
      const h = esc(cr ? text.slice(0, -1) : text);
      const shown = look?.ws ? h.replace(/[ \t]+/g, run => `<span class="ws">${run.replace(/./g, c => (c === '\t' ? '→   ' : '·'))}</span>`) : h;
      // The line end: ¶ for LF, ␍¶ for CRLF; none for the last line of a file without a newline
      const eol = look?.eol && !noEol ? `<span class="ws">${cr ? '␍' : ''}¶</span>` : '';
      return shown + eol || ' ';
    };
    const lineBtns = (/** @type {number} */ i) => {
      const n = lineSel.count(i);
      if (!pickLines || !n) return '';
      return pickLines === 'stage'
        ? `<button data-lines="stage">${t('stageLines', n)}</button><button data-lines="discard">${t('discardLines', n)}</button>`
        : `<button data-lines="unstage">${t('unstageLines', n)}</button>`;
    };
    if (m.missing) return `<div class="dmsg">${t('diffMissing')}</div>`;
    if (m.binary) return (m.images && images?.html(m.images)) || `<div class="dmsg">${t('diffBinary')}</div>`;
    if (!m.hunks.length) return `<div class="dmsg">${t('diffEmpty')}</div>`;
    return m.hunks.map((h, i) => `<div class="hunk" data-i="${i}">
      <div class="hhead"><span class="hh">${esc(h.header)}</span><span class="grow"></span>${lineBtns(i)}${hunkBtns}</div>
      <table>${h.lines.map((l, li) => `<tr class="l l${l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '\\' ? 'meta' : 'ctx'}${pickLines && (l.t === '+' || l.t === '-') ? ` pick${lineSel.has(i, li) ? ' sel' : ''}` : ''}"${pickLines && (l.t === '+' || l.t === '-') ? ` data-l="${li}"` : ''}><td class="ln">${l.o ?? ''}</td><td class="ln">${l.n ?? ''}</td><td class="sg">${l.t === '\\' ? '' : esc(l.t)}</td><td class="tx">${code(l.text, h.lines[li + 1]?.t === '\\')}</td></tr>`).join('')}</table>
    </div>`).join('');
  }

    return diffBody;
  }

  const api = { createDiffBody, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiDiffHtml = api;
})(typeof window !== 'undefined' ? window : globalThis);
