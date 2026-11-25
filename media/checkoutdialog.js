// Fork's "Checkout Branch" dialog, shown when there are local changes: leave them, stash and reapply them, or discard
// them. Under the choice a line says what will happen. Runs in the webview (window.BonsaiCheckoutDialog) and in the tests.
(function (root) {
  /**
   * What the host found out about the switch.
   * @typedef {{ ref: string, changes: number, overwritten: string[], reapplyConflicts?: string[], stash: boolean }} CheckoutInfo
   *   changes counts files with tracked local changes; overwritten are those the other branch has differently;
   *   reapplyConflicts are the files where the changes would conflict once stashed and reapplied (absent: not known);
   *   stash says that "Stash and reapply" was chosen the last time
   */

  const MODES = /** @type {const} */ (['keep', 'stash', 'discard']);
  const MODE_TEXT = { keep: 'coKeep', stash: 'coStash', discard: 'coDiscard' };

  /** A few file names, then a count. */
  const fileList = (/** @type {string[]} */ files, max = 4) => (files.length > max ? `${files.slice(0, max).join(', ')} +${files.length - max}` : files.join(', '));

  /** A commit is shown by its short hash, a branch by its name. */
  const shown = (/** @type {string} */ ref) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, post: (m: any) => void }} deps
   *   t translates a text key; esc escapes for HTML; post sends a message to the host
   */
  function createCheckoutDialog({ t, esc, post }) {
    /** @type {CheckoutInfo | null} */
    let info = null;
    /** @type {'keep' | 'stash' | 'discard'} */
    let mode = 'keep';

    return {
      get isOpen() { return info !== null; },
      get mode() { return mode; },

      open(/** @type {CheckoutInfo} */ checkoutInfo) {
        info = checkoutInfo;
        mode = checkoutInfo.stash ? 'stash' : 'keep'; // never discard: that one is chosen anew every time
      },

      close() { info = null; },

      setMode(/** @type {'keep' | 'stash' | 'discard'} */ next) { mode = next; },

      /** What to say under the choice: { kind: 'warn' | 'info', text }, or null. */
      hint() {
        if (!info) return null;
        if (mode === 'discard') return { kind: 'warn', text: t(info.changes === 1 ? 'coDiscardWarnOne' : 'coDiscardWarn', info.changes) };
        if (mode === 'keep') {
          return info.overwritten.length
            ? { kind: 'warn', text: t('coBlocked', fileList(info.overwritten)) }
            : { kind: 'info', text: t('coAlong') };
        }
        if (!info.reapplyConflicts) return null;
        return info.reapplyConflicts.length
          ? { kind: 'warn', text: t('pullReapplyConflicts', fileList(info.reapplyConflicts)) }
          : { kind: 'info', text: t('pullReapplyClean') };
      },

      /** Sends the switch as chosen; false when the dialog is not open. */
      checkout() {
        if (!info) return false;
        post({ type: 'checkoutWith', ref: info.ref, mode });
        this.close();
        return true;
      },

      html() {
        if (!info) return '';
        const radio = (/** @type {'keep' | 'stash' | 'discard'} */ m) =>
          `<label class="pcheck"><input type="radio" name="comode" data-comode="${m}"${m === mode ? ' checked' : ''}><span>${esc(t(MODE_TEXT[m]))}</span></label>`;
        const hint = this.hint();
        return `<div class="sdlg">
      <div class="mhead"><b>${t('coTitle')}</b><span class="grow"></span><button data-coact="close" title="${t('cancel')}">✕</button></div>
      <div class="shint">${t('coHint')}</div>
      <div class="pform">
        <span>${t('coTo')}</span><span><b>${esc(shown(info.ref))}</b></span>
        <span>${t('coChanges')}</span><div class="pchecks">${MODES.map(radio).join('')}</div>
      </div>
      <div class="phint${hint ? ' ' + hint.kind : ''}"${hint ? '' : ' hidden'}>${hint ? esc(hint.text) : ''}</div>
      <div class="mfoot"><span class="grow"></span>
        <button class="primary" data-coact="checkout">Checkout</button><button data-coact="close">${t('cancel')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createCheckoutDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiCheckoutDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
