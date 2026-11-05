// What the commit list and the sidebar know: the data packet of the host, which commit is selected, the filters, the
// open and closed groups of the ref tree, which view is shown, and when older commits are fetched. Runs in the webview
// (window.BonsaiNav) and in the tests; it decides and talks to the host, main.js draws.
(function (root) {
  /** Hash of the row for the uncommitted changes. */
  const WORKTREE = 'WORKTREE';

  /**
   * @param {{
   *   post: (m: any) => void,
   *   pane: { want(hash: string, stash: boolean): void, clear(): void, readonly hash: string },
   *   saved?: { collapsed?: string[], expanded?: string[] },
   *   save: (state: { collapsed: string[], expanded: string[] }) => void,
   * }} deps  post sends a message to the host; pane is the details pane (media/details.js); saved is what the view kept
   *   of the open and closed groups, save keeps it again
   */
  function createNav({ post, pane, saved = {}, save }) {
    /** @type {{commits: any[], more?: boolean, rows: any[], refs: any[], maxWidth: number, head?: string, currentBranch?: string, staged: any[], unstaged: any[], changeCount?: number, avatars?: Record<string, string>, merge?: {theirs: string, hash: string, message: string, conflicts: number}}} */
    let data = { commits: [], more: false, rows: [], refs: [], maxWidth: 0, staged: [], unstaged: [] };
    /** @type {Map<string, any[]>} */
    let refsByHash = new Map();
    /** @type {Map<string, number>} */
    let indexByHash = new Map();
    let selected = -1;
    let filter = '';
    let refFilter = '';
    /** 'graph' (the commit list) or 'changes' (Local Changes). */
    let view = 'graph';
    // Older commits are fetched when the list nears its end; `loadingMore` holds until the next data packet.
    let loadingMore = false;
    /** Collapsed top-level groups (branches, remotes, tags, stashes). */
    const collapsed = new Set(saved.collapsed ?? ['Tags']);
    /** Expanded folders, key = path like "Remotes/origin/feat". Folders are closed by default. */
    const expanded = new Set(saved.expanded ?? []);

    /** Selects commit `i` and tells the details pane; 'worktree' for the uncommitted-changes row, which has no details. */
    function select(/** @type {number} */ i) {
      if (i < 0 || i >= data.commits.length) return null;
      selected = i;
      const c = data.commits[i];
      if (c.hash === WORKTREE) {
        pane.clear();
        return 'worktree';
      }
      pane.want(c.hash, c.stash !== undefined);
      return 'commit';
    }

    return {
      get data() { return data; },
      get selected() { return selected; },
      get filter() { return filter; },
      get refFilter() { return refFilter; },
      get view() { return view; },

      /** The data packet of the host. The selection follows its commit; a commit that is gone leaves nothing selected. */
      receive(/** @type {typeof data} */ m) {
        const prevHash = data.commits[selected]?.hash;
        data = m;
        loadingMore = false;
        indexByHash = new Map(data.commits.map((c, i) => [c.hash, i]));
        refsByHash = new Map();
        for (const r of data.refs) {
          if (r.kind === 'stash') continue;
          if (!refsByHash.has(r.hash)) refsByHash.set(r.hash, []);
          refsByHash.get(r.hash)?.push(r);
        }
        selected = prevHash !== undefined ? (indexByHash.get(prevHash) ?? -1) : -1;
      },

      /** The host reported an error: a pending request for more commits is over. */
      failed() {
        loadingMore = false;
      },

      /** Nothing is selected and the pane shows something that is no ref either: the details have to go. */
      detailsGone() {
        return selected === -1 && !data.refs.some(r => r.hash === pane.hash);
      },

      /** Position of a commit in the list; undefined when it is not loaded. */
      indexOf(/** @type {string} */ hash) {
        return indexByHash.get(hash);
      },

      /** Branches and remote branches pointing at a commit (stashes excluded). */
      refsAt(/** @type {string} */ hash) {
        return refsByHash.get(hash) ?? [];
      },

      /** Refs of one kind, narrowed by the filter above the sidebar. */
      refsOfKind(/** @type {string} */ kind) {
        const all = data.refs.filter(r => r.kind === kind);
        return refFilter ? all.filter(r => r.name.toLowerCase().includes(refFilter)) : all;
      },

      /** Whether a commit passes the filter; the row of the uncommitted changes always does. */
      matches(/** @type {any} */ c) {
        return !filter || c.hash === WORKTREE ||
          c.subject.toLowerCase().includes(filter) || c.author.toLowerCase().includes(filter) || c.hash.startsWith(filter);
      },

      setFilter(/** @type {string} */ text) {
        filter = text.trim().toLowerCase();
      },

      setRefFilter(/** @type {string} */ text) {
        refFilter = text.trim().toLowerCase();
      },

      /** The next (or, backwards, previous) commit that passes the filter after the selected one, wrapping around; -1 when none does. */
      findMatch(/** @type {boolean} */ backwards) {
        const n = data.commits.length;
        for (let k = 1; k <= n; k++) {
          const i = (selected + (backwards ? -k : k) + n) % n;
          if (this.matches(data.commits[i])) return i;
        }
        return -1;
      },

      setView(/** @type {string} */ v) {
        view = v;
      },

      select,

      /** Where an arrow key leads from the selected row: one row down (by > 0) or up, stopping at the ends. */
      target(/** @type {number} */ by) {
        return by > 0 ? Math.min(selected + 1, data.commits.length - 1) : Math.max(selected - 1, 0);
      },

      /** The selected row is the one for the uncommitted changes. */
      get onWorktree() {
        return data.commits[selected]?.hash === WORKTREE;
      },

      /** A stash whose base commit is not in the log is shown by its own hash; no row is selected then. */
      showStash(/** @type {string} */ hash) {
        selected = -1;
        pane.want(hash, true);
      },

      /**
       * Asks for older commits when the list nears its end. While a filter is active the whole history is fetched, page
       * by page, so that no match stays hidden.
       * @param {{ scrollTop: number, clientHeight: number, scrollHeight: number, rowH: number }} port the visible part of the list
       */
      loadMoreIfNeeded(port) {
        if (!data.more || loadingMore) return;
        if (!filter && port.scrollTop + port.clientHeight < port.scrollHeight - 40 * port.rowH) return;
        loadingMore = true;
        post({ type: 'loadMore' });
      },

      /** A group (Branches …) or a folder of the ref tree is open; while filtering everything is. */
      groupOpen(/** @type {string} */ title) {
        return !!refFilter || !collapsed.has(title);
      },
      folderOpen(/** @type {string} */ key) {
        return !!refFilter || expanded.has(key);
      },

      /** Opens what is in the way of a ref in the sidebar: its group and the folders above it. */
      reveal(/** @type {string} */ group, /** @type {string} */ name) {
        collapsed.delete(group);
        const parts = name.split('/').slice(0, -1);
        parts.forEach((_, i) => expanded.add([group, ...parts.slice(0, i + 1)].join('/')));
        save({ collapsed: [...collapsed], expanded: [...expanded] });
      },

      /** A group title or folder was clicked; the view keeps the state. Nothing happens while filtering. */
      toggle(/** @type {'group' | 'folder'} */ kind, /** @type {string} */ key) {
        if (refFilter) return false;
        const set = kind === 'folder' ? expanded : collapsed;
        if (set.has(key)) set.delete(key); else set.add(key);
        save({ collapsed: [...collapsed], expanded: [...expanded] });
        return true;
      },
    };
  }

  const api = { createNav, WORKTREE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiNav = api;
})(typeof window !== 'undefined' ? window : globalThis);
