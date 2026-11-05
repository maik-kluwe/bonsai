// The diff of the file selected in Local Changes: which diff is on screen, which answers from the host still replace it,
// the marked lines, the sides ticked for a conflict, and the messages that stage, unstage or discard parts of it. Runs in
// the webview (window.BonsaiLocalDiff) and in the tests; it decides and talks to the host, main.js draws.
(function (root) {
  /**
   * What to do with a diff that arrived.
   *  - `stale`: the user has selected something else since; drop it.
   *  - `sameFile`: the diff replaces one of the same file and side, so the scroll position is kept.
   *  - `same`: and its hunks are identical, so marks on lines stay valid (otherwise their numbers no longer match).
   *  - `unchanged`: and nothing else differs either, so there is nothing to draw (a conflict has no hunks, only sides).
   * @param {{ path: string, staged: boolean, hunks?: unknown } | null} shown the diff on screen
   * @param {{ path: string, staged: boolean, hunks?: unknown }} incoming
   * @param {{ path: string, staged: boolean } | null | undefined} selected the file the user has selected now
   */
  function diffUpdate(shown, incoming, selected) {
    if (!selected || incoming.path !== selected.path || incoming.staged !== selected.staged) return { stale: true, sameFile: false, same: false, unchanged: false };
    const sameFile = !!shown && shown.path === incoming.path && shown.staged === incoming.staged;
    const same = sameFile && JSON.stringify(shown.hunks) === JSON.stringify(incoming.hunks);
    return { stale: false, sameFile, same, unchanged: same && JSON.stringify(shown) === JSON.stringify(incoming) };
  }

  /**
   * Whether single lines of a diff can be staged or unstaged, and in which direction. Added and deleted files have
   * no second state a single line could move to: only whole hunks there. Untracked and conflicted files neither.
   * @param {{ untracked?: boolean, conflict?: boolean, staged: boolean }} diff
   * @param {string} status letter of the file (A, M, D …)
   * @returns {null | 'stage' | 'unstage'}
   */
  function lineAction(diff, status) {
    if (diff.untracked || diff.conflict || status === 'A' || status === 'D') return null;
    return diff.staged ? 'unstage' : 'stage';
  }

  /**
   * @param {{
   *   post: (m: any) => void,
   *   look: { asked(): number, accepts(a: any, checkWhitespace: boolean): boolean, change(which?: string): { reload: boolean } },
   *   lineSel: { clear(): void, lines(): number[], click(h: number, line: number, mods: any, selectable: number[]): void },
   * }} deps  post sends a message to the host; look is the diff toolbar's look (media/look.js); lineSel the marked lines (media/linesel.js)
   */
  function createLocalDiff({ post, look, lineSel }) {
    /** @type {any} The diff on screen (an answer of the host: path, staged, hunks, context, sides …). */
    let shown = null;
    /** Which sides the user ticked for the conflict file (as in Fork: both by default). */
    let pick = { path: '', theirs: true, ours: true };

    /** A hunk on screen as the host compares it (`hunkBody` in src/diff.ts). */
    const body = (/** @type {number} */ i) => shown.hunks[i].lines.map((/** @type {any} */ l) => l.t + l.text);

    /** Takes `m` as the diff on screen unless it is stale; marks stay only when the hunks are the same. */
    function take(/** @type {any} */ m, /** @type {{ path: string, staged: boolean } | null | undefined} */ target) {
      const update = diffUpdate(shown, m, target);
      if (update.stale) return null;
      if (!update.same) lineSel.clear();
      shown = m;
      return update;
    }

    /** Asks the host for the diff the selection wants to show. */
    function load(/** @type {{ path: string, staged: boolean } | null} */ d) {
      if (d) post({ type: 'loadDiff', path: d.path, staged: d.staged, context: look.asked() });
    }

    return {
      get shown() { return shown; },
      load,

      /** The view was emptied: whatever arrives next has to be drawn, even if it equals the last diff. */
      forget() { shown = null; },

      /**
       * The host sent a diff. Returns null when it is not wanted (made with another context than the toolbar asks for now, or
       * for a file that is no longer the selected one), otherwise what changed against the one on screen.
       * @param {{ path: string, staged: boolean } | null | undefined} target the file the user has selected now
       */
      receive(/** @type {any} */ m, target) {
        return look.accepts(m, false) ? take(m, target) : null;
      },

      /** The diff on screen is drawn again after a click; null when nothing is on screen or the selection moved on. */
      again(/** @type {{ path: string, staged: boolean } | null | undefined} */ target) {
        return shown ? take(shown, target) : null;
      },

      /** A button of the diff toolbar was clicked; a look that needs another diff fetches it. */
      changeLook(/** @type {string | undefined} */ which) {
        if (!shown) return;
        if (look.change(which).reload) {
          lineSel.clear();
          load({ path: shown.path, staged: shown.staged });
        }
      },

      /** Stage, unstage or discard one hunk. `index` counts in the diff on screen, so it is sent with the context that diff was made with. */
      hunk(/** @type {number} */ index, /** @type {string} */ action) {
        post({ type: 'hunk', path: shown.path, staged: shown.staged, index, action, context: shown.context, expect: body(index) });
      },

      /** The same for the marked lines of one hunk; the marks are gone afterwards. */
      lines(/** @type {number} */ hunk, /** @type {string} */ action) {
        post({ type: 'lines', path: shown.path, staged: shown.staged, hunk, lines: lineSel.lines(), action, context: shown.context, expect: body(hunk) });
        lineSel.clear();
      },

      /** A changed line was clicked: marks it (with Ctrl/Shift as in the Explorer). */
      mark(/** @type {number} */ hunk, /** @type {number} */ line, /** @type {any} */ mods) {
        const selectable = shown.hunks[hunk].lines.flatMap((/** @type {any} */ l, /** @type {number} */ i) => (l.t === '+' || l.t === '-' ? [i] : []));
        lineSel.click(hunk, line, mods, selectable);
      },

      /**
       * A button of the diff header. Returns 'merge' for the one that opens the merge dialog, which this module does not
       * know; the others are sent to the host.
       */
      fileAction(/** @type {string} */ name) {
        const { path, staged } = shown;
        if (name === 'open') post({ type: 'openFile', path });
        else if (name === 'vsdiff') post({ type: 'openChange', path, staged });
        else if (name === 'mergeEditor') post({ type: 'mergeEditor', path });
        else if (name === 'resolveOurs' || name === 'resolveTheirs') post({ type: 'resolveUsing', side: name === 'resolveOurs' ? 'ours' : 'theirs', paths: [path] });
        else if (name === 'merge') return 'merge';
        return null;
      },

      /** The sides ticked for the conflict file at `path`; a new file starts with both. */
      picked(/** @type {string} */ path) {
        if (pick.path !== path) pick = { path, theirs: true, ours: true };
        return pick;
      },

      /** A side's checkbox was clicked. */
      setPick(/** @type {'ours' | 'theirs'} */ side, /** @type {boolean} */ checked) {
        pick[side] = checked;
      },
    };
  }

  const api = { createLocalDiff, diffUpdate, lineAction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiLocalDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
