// The window that opens when an operation stops on conflicts: which files, and what Git printed behind a fold, instead
// of a plain message box full of raw text. Runs in the webview (window.BonsaiConflictDialog) and in the tests.
(function (root) {
  const MAX_FILES = 12;

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string }} deps
   *   t translates a text key; esc escapes for HTML
   */
  function createConflictDialog({ t, esc }) {
    /** @type {{ files: string[], output: string } | null} */
    let data = null;

    return {
      get isOpen() { return data !== null; },

      open(/** @type {{ files: string[], output: string }} */ conflicts) { data = conflicts; },

      close() { data = null; },

      html() {
        if (!data) return '';
        const { files, output } = data;
        const shown = files.slice(0, MAX_FILES).map(f => `<li title="${esc(f)}">${esc(f)}</li>`);
        if (files.length > MAX_FILES) shown.push(`<li class="more">+${files.length - MAX_FILES}</li>`);
        const what = files.length === 1 ? t('conflictOne') : t('conflictMany', files.length);
        return `<div class="sdlg">
      <div class="mhead"><b>${t('conflictsDlgTitle')}</b><span class="grow"></span><button data-cact="close" title="${t('cancel')}">✕</button></div>
      <div class="shint">${files.length ? `${what} ` : ''}${t('conflictHow')}</div>
      ${files.length ? `<ul class="cfiles">${shown.join('')}</ul>` : ''}
      ${output.trim() ? `<details class="cout"><summary>${t('conflictOutput')}</summary><pre class="poutput">${esc(output.trim())}</pre></details>` : ''}
      <div class="mfoot"><span class="grow"></span>
        <button class="primary" data-cact="resolve">${t('conflictResolve')}</button><button data-cact="close">${t('pushClose')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createConflictDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiConflictDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
