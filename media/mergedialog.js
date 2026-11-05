// The merge dialog of one conflict file, without its drawing: which file it was opened for, the resolution the user is
// building (media/mergeresolve.js), the conflict the view is at, and what happens to the host's answer. Runs in the
// webview (window.BonsaiMergeDialog) and in the tests; it decides and talks to the host, main.js draws.
(function (root) {
  /**
   * @param {{ post: (m: any) => void, createResolution: (segments: any[], opts: any) => any }} deps
   *   post sends a message to the host; createResolution builds the result from the segments (media/mergeresolve.js)
   */
  function createMergeDialog({ post, createResolution }) {
    /** File the dialog is open for; null when it is closed. */
    let openPath = null;
    /** @type {null | { path: string, res: any, view: 'auto' | 'manual', cur: number }} Set once the inputs have arrived: `res` decides selection and content, `view` says what the result field shows, `cur` the conflict the view is at. */
    let state = null;

    return {
      get isOpen() { return openPath !== null; },
      get path() { return openPath; },
      /** null while the inputs are loading. */
      get state() { return state; },

      /** The dialog is opened for a file: ask the host for its inputs. */
      open(/** @type {string} */ path) {
        openPath = path;
        state = null;
        post({ type: 'mergeInputs', path });
      },

      close() {
        openPath = null;
        state = null;
      },

      /**
       * The host sent the inputs. `stale`: the dialog is closed or open for another file, nothing to do. `refused`: the
       * file cannot be merged here (deleted, binary, large); the dialog is closed. `ready`: the resolution is built.
       * @param {{ path: string, result: any }} m
       * @param {{ ours: string, theirs: string }} names branch names for the conflict markers
       * @returns {{ stale: true } | { refused: string } | { ready: true }}
       */
      receive(m, names) {
        if (openPath === null || openPath !== m.path) return { stale: true };
        const r = m.result;
        if (!r.ok) {
          this.close();
          return { refused: r.reason };
        }
        const res = createResolution(r.segments, { eol: r.eol, finalNewline: r.finalNewline, ours: names.ours, theirs: names.theirs });
        state = { path: m.path, res, view: 'auto', cur: 0 };
        return { ready: true };
      },

      /** A checkbox of one conflict. */
      choose(/** @type {number} */ ci, /** @type {'ours' | 'theirs'} */ side, /** @type {boolean} */ on) {
        state?.res.choose(ci, side, on);
      },

      /** The checkbox at the top of a side: all conflicts. */
      takeAll(/** @type {'ours' | 'theirs'} */ side, /** @type {boolean} */ on) {
        state?.res.takeAll(side, on);
      },

      /** The user typed into the result field. */
      setManual(/** @type {string} */ text) {
        state?.res.setManual(text);
      },

      /** The button above the result: edit by hand, or back to the selection. The view has to rebuild the field. */
      toggleManual() {
        if (!state) return;
        if (state.res.isManual()) state.res.endManual(); else state.res.startManual();
        state.view = state.res.isManual() ? 'auto' : 'manual';
      },

      /** Moves to conflict `i`, wrapping around; returns its index, or -1 when there is none to go to. */
      goTo(/** @type {number} */ i) {
        if (!state || !state.res.total) return -1;
        state.cur = (i + state.res.total) % state.res.total;
        return state.cur;
      },

      /** The previous or next conflict. */
      step(/** @type {number} */ by) {
        return state ? this.goTo(state.cur + by) : -1;
      },

      /** Writes the result, once every conflict is decided, and closes the dialog. */
      resolve() {
        if (!state || !state.res.canResolve()) return false;
        post({ type: 'mergeResolve', path: state.path, content: state.res.content() });
        this.close();
        return true;
      },
    };
  }

  const api = { createMergeDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiMergeDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
