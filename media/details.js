// What the details pane under the commit list knows: which commit (or stash) it asked for, the commit that came back,
// which tab is open, which files are expanded, and the diffs fetched so far. Answers arrive late and in any order, so
// it also decides which of them still count. Runs in the webview (window.BonsaiDetails) and in the tests; it decides
// and talks to the host, main.js draws.
(function (root) {
  /**
   * @param {{ post: (m: any) => void, look: { value: { iws: boolean }, asked(): number, accepts(a: any, checkWhitespace: boolean): boolean, change(which?: string): { reload: boolean } } }} deps
   *   post sends a message to the host; look is the diff toolbar's look (media/look.js)
   */
  function createDetails({ post, look }) {
    /** Hash whose details are currently requested (commit or stash). */
    let hash = '';
    /** @type {any} the commit the host answered with: subject, body, parents, files … */
    let current;
    /** 'commit': the commit's data with expandable diffs; 'changes': one file's diff beside the file list. */
    let tab = 'commit';
    /** File shown in the Changes tab. */
    let changesPath = '';
    /** Expanded files of the commit tab. */
    const openFiles = new Set();
    /** @type {Map<string, any>} Diffs of the commit tab. */
    const inlineDiffs = new Map();
    /** @type {Map<string, any>} Diffs of the Changes tab, fetched with the context and whitespace setting of the look; emptied when those change. */
    const changeDiffs = new Map();

    const fileAt = (/** @type {string} */ path) => current?.files.find((/** @type {any} */ f) => f.path === path);

    /** Asks the host for the diff of one file of the shown commit, unless it is already here. */
    function requestInline(/** @type {string} */ path) {
      const f = fileAt(path);
      if (f && !inlineDiffs.has(path)) post({ type: 'fileDiff', hash: current.hash, parent: current.parents[0], ...f });
    }

    /** Same for the Changes tab, with the context lines of the toolbar. */
    function requestChange(/** @type {string} */ path) {
      const f = fileAt(path);
      if (f && !changeDiffs.has(path)) {
        post({ type: 'fileDiff', hash: current.hash, parent: current.parents[0], ...f, context: look.asked(), ...(look.value.iws ? { ignoreSpace: true } : {}) });
      }
    }

    return {
      get hash() { return hash; },
      get current() { return current; },
      get tab() { return tab; },
      get changesPath() { return changesPath; },
      openFiles,
      inlineDiffs,
      changeDiffs,

      /** The user picked a commit or stash: ask for it. */
      want(/** @type {string} */ h, /** @type {boolean} */ stash) {
        hash = h;
        post({ type: 'details', hash: h, stash });
      },

      /** Nothing is picked any more. */
      clear() {
        hash = '';
      },

      /**
       * The host answered. An answer for something else than the last request is dropped (false). A different commit than
       * the one shown starts with empty caches. `isStash`: the hash is a stash.
       */
      show(/** @type {any} */ d, /** @type {boolean} */ isStash) {
        if (d.hash !== hash) return false;
        if (current?.hash !== d.hash) { openFiles.clear(); inlineDiffs.clear(); changeDiffs.clear(); changesPath = ''; }
        current = d;
        current.isStash = isStash;
        return true;
      },

      /** A tab button was clicked; true when that changes the tab. */
      setTab(/** @type {string | undefined} */ id) {
        if (!current || (id ?? 'commit') === tab) return false;
        tab = id ?? 'commit';
        return true;
      },

      /** The Changes tab is about to be drawn: make sure a file of this commit is the shown one, and fetch its diff. */
      enterChanges() {
        if (!current.files.some((/** @type {any} */ f) => f.path === changesPath)) changesPath = current.files[0]?.path ?? '';
        requestChange(changesPath);
      },

      /** A file was clicked in the Changes tab. */
      pickChange(/** @type {string} */ path) {
        changesPath = path;
        requestChange(path);
      },

      /** A file was clicked in the commit tab: expand or collapse its diff. */
      toggleFile(/** @type {string} */ path) {
        if (openFiles.has(path)) openFiles.delete(path);
        else {
          openFiles.add(path);
          requestInline(path);
        }
      },

      /** A button of the diff toolbar in the Changes tab was clicked; when the look needs other diffs they are fetched again. */
      changeLook(/** @type {string | undefined} */ which) {
        if (look.change(which).reload) {
          changeDiffs.clear();
          requestChange(changesPath);
        }
      },

      /**
       * A diff arrived. Returns what has to be drawn again: 'changes' (the diff beside the file list), 'files' (the list
       * of the commit tab), or null when it does not matter now. Answers for another commit or an outdated look are dropped.
       */
      onFileDiff(/** @type {any} */ m) {
        if (!current || m.hash !== current.hash) return null;
        // Answers that name their context belong to the Changes tab
        if (m.context !== undefined) {
          if (!look.accepts(m, true)) return null;
          changeDiffs.set(m.path, m);
          return tab === 'changes' && m.path === changesPath ? 'changes' : null;
        }
        inlineDiffs.set(m.path, m);
        return tab === 'commit' && openFiles.has(m.path) ? 'files' : null;
      },
    };
  }

  const api = { createDetails };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiDetails = api;
})(typeof window !== 'undefined' ? window : globalThis);
