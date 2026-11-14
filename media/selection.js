// Selection in the changes list (unstaged/staged). Runs in the webview (window.BonsaiSelection) and in the tests (require).
(function (root) {
  /**
   * Selected files per list (multi-select as in the Explorer) and the file whose diff is shown.
   * The module knows neither DOM nor host: it is handed the current lists `{unstaged, staged}` and says
   * which diff to show. Sending messages and rendering remain the caller's job.
   */
  function createSelection() {
    const marked = { unstaged: new Set(), staged: new Set() };
    /** Anchor for the Shift selection */
    let anchor = null;
    /** File in the diff: path, list and position (for the successor when it disappears) */
    let target = null;
    const otherOf = which => which === 'staged' ? 'unstaged' : 'staged';

    /** Set the diff target; false if the file is not in the list. */
    function show(path, staged, files) {
      const index = files[staged ? 'staged' : 'unstaged'].findIndex(f => f.path === path);
      if (index === -1) return false;
      target = { path, staged, index };
      return true;
    }

    return {
      has(which, path) { return marked[which].has(path); },
      count(which) { return marked[which].size; },
      paths(which) { return [...marked[which]]; },
      /** File in the diff, or null. */
      target() { return target; },

      /**
       * Click as in the Explorer: plain, Ctrl/Cmd = toggle, Shift = range (with Ctrl: add to the selection).
       * The selection is always in a single list. Returns: the diff to show, or null (deselected).
       * @param {'staged' | 'unstaged'} which
       * @param {{unstaged: {path: string}[], staged: {path: string}[]}} files
       * @param {{shift?: boolean, ctrl?: boolean}} mods
       */
      click(which, files, i, mods = {}) {
        const list = files[which];
        const path = list[i].path;
        const set = marked[which];
        marked[otherOf(which)].clear();
        if (mods.shift && anchor?.list === which) {
          const a = list.findIndex(f => f.path === anchor.path);
          const [from, to] = a < i ? [a, i] : [i, a];
          if (!mods.ctrl) set.clear();
          for (let k = Math.max(from, 0); k <= to; k++) set.add(list[k].path);
        } else if (mods.ctrl) {
          if (set.has(path)) set.delete(path); else set.add(path);
          anchor = { list: which, path };
        } else {
          set.clear();
          set.add(path);
          anchor = { list: which, path };
        }
        if (!set.has(path)) return null;
        show(path, which === 'staged', files);
        return { path, staged: which === 'staged' };
      },

      /**
       * Arrow key: select the file `delta` rows from the diff file, like a click on it (Shift extends the range).
       * @param {'staged' | 'unstaged'} which
       * @param {{unstaged: {path: string}[], staged: {path: string}[]}} files
       * @param {number} delta
       * @param {{shift?: boolean}} mods
       */
      move(which, files, delta, mods = {}) {
        const list = files[which];
        if (!list.length) return null;
        const at = target && target.staged === (which === 'staged') ? list.findIndex(f => f.path === target.path) : -1;
        return this.click(which, files, at === -1 ? 0 : Math.min(list.length - 1, Math.max(0, at + delta)), { shift: mods.shift });
      },

      /** Ctrl+A: select all files of the list. */
      selectAll(which, files) {
        marked[otherOf(which)].clear();
        marked[which] = new Set(files[which].map(f => f.path));
      },

      /** Select only this file and show its diff (e.g. jump to the first conflict file). Returns like `click`. */
      only(which, path, files) {
        marked[otherOf(which)].clear();
        marked[which] = new Set([path]);
        return show(path, which === 'staged', files) ? { path, staged: which === 'staged' } : null;
      },

      /** Remove selections of files that are no longer in the lists. */
      prune(files) {
        for (const which of ['unstaged', 'staged']) {
          const present = new Set(files[which].map(f => f.path));
          for (const p of [...marked[which]]) if (!present.has(p)) marked[which].delete(p);
        }
      },

      /**
       * After each refresh: keep the diff file; if it moved to the other list and its list is empty, continue there;
       * otherwise pick the successor at the same position. Returns: the diff to show, `'clear'` (nothing left to
       * select) or null (there was no diff target).
       */
      restore(files) {
        if (!target) return null;
        const which = target.staged ? 'staged' : 'unstaged';
        const list = files[which];
        if (list.some(f => f.path === target.path)) { show(target.path, target.staged, files); return { path: target.path, staged: target.staged }; }
        const other = otherOf(which);
        if (!list.length && files[other].some(f => f.path === target.path)) {
          const path = target.path, staged = !target.staged;
          marked[other] = new Set([path]);
          show(path, staged, files);
          return { path, staged };
        }
        const i = Math.min(target.index, list.length - 1);
        if (i < 0) { target = null; return 'clear'; }
        const staged = target.staged;
        if (!marked[which].size) marked[which].add(list[i].path);
        show(list[i].path, staged, files);
        return { path: list[i].path, staged };
      },
    };
  }

  const api = { createSelection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiSelection = api;
})(typeof window !== 'undefined' ? window : globalThis);
