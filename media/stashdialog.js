// The dialog that stashes chosen files, as in Fork: every changed file with a checkbox, the marked ones ticked, and an
// optional message. Runs in the webview (window.BonsaiStashDialog) and in the tests; main.js puts the HTML on the page.
(function (root) {
  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, post: (m: any) => void }} deps
   *   t translates a text key; esc escapes for HTML; post sends a message to the host
   */
  function createStashDialog({ t, esc, post }) {
    /** @type {{ path: string, oldPath?: string }[] | null} */
    let files = null;
    /** @type {Set<string>} */
    let ticked = new Set();

    return {
      get isOpen() { return files !== null; },
      get canSave() { return ticked.size > 0; },

      /**
       * @param {string[]} paths  the files marked in the list, ticked from the start
       * @param {{ staged: { path: string, oldPath?: string }[], unstaged: { path: string, oldPath?: string }[] }} lists
       */
      open(paths, { staged, unstaged }) {
        const byPath = new Map([...unstaged, ...staged].map(f => [f.path, f]));
        files = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        ticked = new Set(paths);
      },

      close() { files = null; ticked = new Set(); },

      toggle(/** @type {string} */ path, /** @type {boolean} */ on) {
        if (on) ticked.add(path); else ticked.delete(path);
      },

      /** Sends the ticked files, the old side of a rename with them; false when there is nothing to send. */
      save(/** @type {string} */ message) {
        if (!files || !ticked.size) return false;
        const paths = files.filter(f => ticked.has(f.path)).flatMap(f => (f.oldPath ? [f.path, f.oldPath] : [f.path]));
        post({ type: 'stashFiles', paths, message: message.trim() });
        this.close();
        return true;
      },

      html() {
        const row = (/** @type {{ path: string }} */ f) =>
          `<label class="sfile"><input type="checkbox" class="scb" data-path="${esc(f.path)}"${ticked.has(f.path) ? ' checked' : ''}><span>${esc(f.path)}</span></label>`;
        return `<div class="sdlg">
      <div class="mhead"><b>${t('stashDlgTitle')}</b><span class="grow"></span><button data-sact="close" title="${t('cancel')}">✕</button></div>
      <div class="shint">${t('stashDlgHint')}</div>
      <div class="sfiles">${(files ?? []).map(row).join('')}</div>
      <input type="text" class="smsg" id="smsg" placeholder="${t('promptStashMsg')}">
      <div class="mfoot"><span class="grow"></span>
        <button class="primary" data-sact="save" id="ssave">${t('stashDlgSave')}</button><button data-sact="close">${t('cancel')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createStashDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiStashDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
