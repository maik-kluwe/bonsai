// The pull dialog as in Fork: where from and where to, "Rebase instead of merge" and "Stash and reapply local changes".
// Unlike Fork's, it knows what the host found out after fetching and says what the boxes will do. It never ticks a box
// on its own: it starts with what the user ticked the last time. Runs in the webview (window.BonsaiPullDialog) and in the tests.
(function (root) {
  /**
   * What the host sends once it has fetched.
   * @typedef {{
   *   upstream: string, into: string, behind: number,
   *   changes: number, overwritten: string[], reapplyConflicts?: string[], rebase: boolean, last?: { rebase: boolean, stash: boolean },
   * }} PullInfo
   *   changes counts files with tracked local changes; overwritten are those that the incoming commits touch, too;
   *   reapplyConflicts are the files where the changes would conflict once stashed and reapplied (absent: not known);
   *   rebase is what the Git settings say, last what the user ticked the last time (absent: never)
   */

  /**
   * Git refuses a merge when local changes lie in files the merge touches, and a rebase when there are any at all.
   * @param {PullInfo} info
   * @param {boolean} rebase
   */
  function needsStash(info, rebase) {
    return info.behind > 0 && (rebase ? info.changes > 0 : info.overwritten.length > 0);
  }

  /** A few file names, then a count: the dialog is not the place for a list of hundreds. */
  function fileList(/** @type {string[]} */ files, max = 4) {
    return files.length > max ? `${files.slice(0, max).join(', ')} +${files.length - max}` : files.join(', ');
  }

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, post: (m: any) => void }} deps
   *   t translates a text key; esc escapes for HTML; post sends a message to the host
   */
  function createPullDialog({ t, esc, post }) {
    /** @type {PullInfo | null} */
    let info = null;
    let rebase = false;
    let stash = false;

    return {
      get isOpen() { return info !== null; },
      get options() { return { rebase, stash }; },

      open(/** @type {PullInfo} */ pullInfo) {
        info = pullInfo;
        rebase = pullInfo.last?.rebase ?? pullInfo.rebase;
        stash = pullInfo.last?.stash ?? false;
      },

      close() { info = null; },

      setOption(/** @type {'rebase' | 'stash'} */ name, /** @type {boolean} */ on) {
        if (name === 'rebase') rebase = on; else stash = on;
      },

      /** What to say under the boxes: { kind: 'warn' | 'info', text }, or null when there is nothing to add. */
      hint() {
        if (!info) return null;
        if (info.behind === 0) return { kind: 'info', text: t('pullUpToDate') };
        if (needsStash(info, rebase) && !stash) {
          return { kind: 'warn', text: rebase ? t('pullBlockedRebase') : t('pullBlockedMerge', fileList(info.overwritten)) };
        }
        if (stash && info.changes > 0 && info.reapplyConflicts) {
          return info.reapplyConflicts.length
            ? { kind: 'warn', text: t('pullReapplyConflicts', fileList(info.reapplyConflicts)) }
            : { kind: 'info', text: t('pullReapplyClean') };
        }
        return null;
      },

      /** Sends the pull, and with it the boxes as they are, which the host keeps for next time; false when the dialog is not open. */
      pull() {
        if (!info) return false;
        post({ type: 'pull', rebase, stash });
        this.close();
        return true;
      },

      html() {
        if (!info) return '';
        const check = (/** @type {string} */ name, /** @type {boolean} */ on, /** @type {string} */ text) =>
          `<label class="pcheck"><input type="checkbox" data-pullopt="${name}"${on ? ' checked' : ''}><span>${esc(text)}</span></label>`;
        const hint = this.hint();
        const behind = info.behind > 0 ? ` <span class="pnote">${esc(t(info.behind === 1 ? 'pullBehindOne' : 'pullBehind', info.behind))}</span>` : '';
        return `<div class="sdlg">
      <div class="mhead"><b>Pull</b><span class="grow"></span><button data-pullact="close" title="${t('cancel')}">✕</button></div>
      <div class="shint">${t('pullHint')}</div>
      <div class="pform">
        <span>${t('pullFrom')}</span><span><b>${esc(info.upstream)}</b>${behind}</span>
        <span>${t('pullInto')}</span><span><b>${esc(info.into)}</b></span>
        <span></span><div class="pchecks">${check('rebase', rebase, t('pullRebase'))}${check('stash', stash, t('pullStash'))}</div>
      </div>
      <div class="phint${hint ? ' ' + hint.kind : ''}"${hint ? '' : ' hidden'}>${hint ? esc(hint.text) : ''}</div>
      <div class="mfoot"><span class="grow"></span>
        <button class="primary" data-pullact="pull">Pull</button><button data-pullact="close">${t('cancel')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createPullDialog, needsStash, fileList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiPullDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
