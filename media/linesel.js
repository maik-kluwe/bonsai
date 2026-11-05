// Line selection inside one diff hunk. Runs in the webview (window.BonsaiLineSel) and in the tests.
(function (root) {
  /**
   * Which changed lines of a hunk are marked for "Stage lines" and friends. Indices are positions in `hunk.lines`.
   * The selection lives in one hunk at a time: marking a line elsewhere starts over there, because the host
   * builds one patch per hunk.
   * Plain click marks one line (and unmarks it again when it is the only one), Ctrl/Cmd toggles, Shift marks
   * the changed lines between the last click and this one.
   */
  function createLineSelection() {
    let hunk = -1;
    let marked = new Set();
    let anchor = -1;

    return {
      /**
       * @param {number} h hunk index
       * @param {number} line line index within the hunk
       * @param {{ shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean }} mods
       * @param {number[]} selectable indices of the changed lines of hunk `h`
       */
      click(h, line, mods, selectable) {
        if (h !== hunk) { hunk = h; marked = new Set(); anchor = -1; }
        if (mods.shiftKey && anchor >= 0) {
          const lo = Math.min(anchor, line), hi = Math.max(anchor, line);
          marked = new Set(selectable.filter(i => i >= lo && i <= hi));
        } else if (mods.ctrlKey || mods.metaKey) {
          if (marked.has(line)) marked.delete(line); else marked.add(line);
          anchor = line;
        } else {
          marked = marked.size === 1 && marked.has(line) ? new Set() : new Set([line]);
          anchor = line;
        }
        if (!marked.size) { hunk = -1; anchor = -1; }
      },
      has: (/** @type {number} */ h, /** @type {number} */ line) => h === hunk && marked.has(line),
      count: (/** @type {number} */ h) => (h === hunk ? marked.size : 0),
      /** Marked line indices in ascending order. */
      lines: () => [...marked].sort((a, b) => a - b),
      hunk: () => hunk,
      clear() { hunk = -1; marked = new Set(); anchor = -1; },
    };
  }

  const api = { createLineSelection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiLineSel = api;
})(typeof window !== 'undefined' ? window : globalThis);
