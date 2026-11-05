// The look of the diffs (the toolbar above them) and what follows from it for questions and answers: how many lines of
// context are asked for, which answers from the host still fit. The host keeps the look (saveLook / look) so it survives
// a reload. Runs in the webview (window.BonsaiLook) and in the tests; it decides, main.js draws.
(function (root) {
  /** What the host is asked for when the whole file is wanted. */
  const WHOLE_FILE = 100000;
  /** The steps of the "more / less context" buttons. */
  const CONTEXTS = [0, 1, 3, 5, 10, 25];

  /**
   * @param {(m: any) => void} post sends a message to the host
   * ws: show spaces, eol: show line endings, wrap: wrap long lines, iws: ignore whitespace (only offered where nothing is
   * staged from the diff), ctx: lines around a change, null = the whole file.
   */
  function createLook(post) {
    const value = { ws: false, eol: false, wrap: false, iws: false, ctx: /** @type {number | null} */ (3) };

    return {
      /** The look itself; the object stays the same, so the view may hold on to it. */
      value,

      /** Takes over the look the host kept. */
      apply(/** @type {Partial<typeof value> | undefined} */ saved) {
        if (saved) Object.assign(value, saved);
      },

      /** Lines of context to ask the host for. */
      asked() {
        return value.ctx ?? WHOLE_FILE;
      },

      /**
       * A click on a toolbar button. The host keeps the new look.
       * `reload`: the diff has to be fetched again (another context, or whitespace counted differently).
       * @param {string | undefined} which
       */
      change(which) {
        const was = { ctx: value.ctx, iws: value.iws };
        switch (which) {
          case 'ws': value.ws = !value.ws; break;
          case 'eol': value.eol = !value.eol; break;
          case 'wrap': value.wrap = !value.wrap; break;
          case 'iws': value.iws = !value.iws; break;
          case 'lessCtx': value.ctx = [...CONTEXTS].reverse().find(c => c < (was.ctx ?? Infinity)) ?? 0; break;
          case 'moreCtx': value.ctx = CONTEXTS.find(c => c > (was.ctx ?? 0)) ?? null; break;
          case 'allCtx': value.ctx = was.ctx === null ? 3 : null; break;
        }
        post({ type: 'saveLook', look: { ...value } });
        return { reload: was.ctx !== value.ctx || was.iws !== value.iws };
      },

      /**
       * Whether an answer still matches the question as the toolbar stands now. Answers without a context (the plain
       * diff of the commit pane) always do. `checkWhitespace`: the view asks with -w, so the answer has to agree.
       * @param {{ context?: number, ignoreSpace?: boolean }} answer
       */
      accepts(answer, checkWhitespace) {
        if (answer.context === undefined) return true;
        return answer.context === (value.ctx ?? WHOLE_FILE) && (!checkWhitespace || !!answer.ignoreSpace === value.iws);
      },
    };
  }

  const api = { createLook, WHOLE_FILE, CONTEXTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiLook = api;
})(typeof window !== 'undefined' ? window : globalThis);
