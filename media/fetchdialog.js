// The fetch dialog as in Fork: one remote, or all of them. Runs in the webview (window.BonsaiFetchDialog) and in the tests.
(function (root) {
  /**
   * The remote that is offered first: the one the current branch tracks, else the first.
   * @param {string[]} remotes
   * @param {{ refs: any[], currentBranch?: string }} data
   */
  function defaultRemote(remotes, { refs, currentBranch }) {
    const upstream = refs.find(r => r.kind === 'head' && r.name === currentBranch)?.upstream;
    return remotes.find(r => upstream?.startsWith(`${r}/`)) ?? remotes[0] ?? '';
  }

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, post: (m: any) => void }} deps
   *   t translates a text key; esc escapes for HTML; post sends a message to the host
   */
  function createFetchDialog({ t, esc, post }) {
    /** @type {string[] | null} */
    let remotes = null;
    let remote = '';
    let all = true;

    return {
      get isOpen() { return remotes !== null; },
      get canFetch() { return remotes !== null && remotes.length > 0 && (all || remote !== ''); },

      open(/** @type {{ refs: any[], remotes?: string[], currentBranch?: string }} */ data) {
        remotes = data.remotes ?? [];
        remote = defaultRemote(remotes, data);
        all = true;
      },

      close() { remotes = null; },

      setRemote(/** @type {string} */ name) { remote = name; },
      setAll(/** @type {boolean} */ on) { all = on; },

      /** Sends the fetch; without a remote name it means all of them. False when there is nothing to fetch from. */
      fetch() {
        if (!this.canFetch) return false;
        post(all ? { type: 'fetch' } : { type: 'fetch', remote });
        this.close();
        return true;
      },

      html() {
        const option = (/** @type {string} */ name) => `<option value="${esc(name)}"${name === remote ? ' selected' : ''}>${esc(name)}</option>`;
        return `<div class="sdlg">
      <div class="mhead"><b>Fetch</b><span class="grow"></span><button data-fetchact="close" title="${t('cancel')}">✕</button></div>
      <div class="shint">${t('fetchHint')}</div>
      <div class="pform">
        <label for="fremote">${t('fetchRemote')}</label><select id="fremote"${all ? ' disabled' : ''}>${(remotes ?? []).map(option).join('')}</select>
        <span></span><div class="pchecks"><label class="pcheck"><input type="checkbox" data-fetchopt="all"${all ? ' checked' : ''}><span>${t('fetchAll')}</span></label></div>
      </div>
      <div class="mfoot"><span class="grow"></span>
        <button class="primary" data-fetchact="fetch"${this.canFetch ? '' : ' disabled'}>Fetch</button><button data-fetchact="close">${t('cancel')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createFetchDialog, defaultRemote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiFetchDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
