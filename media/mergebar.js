// What the banner of a running merge, cherry-pick, revert or rebase says and offers. Runs in the webview
// (window.BonsaiMergeBar) and in the tests; it only decides, main.js draws.
(function (root) {
  /**
   * @param {{ kind: 'merge' | 'cherryPick' | 'revert' | 'rebase' | 'conflicts', theirs: string, conflicts: number, rebase?: { branch: string, step: number, total: number } }} m
   * @param {string | undefined} currentBranch
   * @returns {{ what: (string | number)[], todo: (string | number)[], buttons: { action: 'resolve' | 'continue' | 'skip' | 'abort', label: string }[] }}
   *   `what` and `todo` are a text key followed by its arguments; `label` is a text key.
   */
  function mergeBanner(m, currentBranch) {
    const n = m.conflicts;
    const done = m.kind === 'merge' ? 'mergeAllResolved' : m.kind === 'rebase' ? 'rebaseAllResolved' : 'opAllResolved';
    const todo = n === 0 ? [done] : n === 1 ? ['mergeFixOne'] : ['mergeFixMany', n];
    const what =
      m.kind === 'conflicts' ? ['conflictsOpen']
      : m.kind === 'cherryPick' ? ['cherryPickingCommit', m.theirs]
      : m.kind === 'revert' ? ['revertingCommit', m.theirs]
      : m.kind === 'rebase' ? (m.rebase ? ['rebasingBranch', m.rebase.branch, m.rebase.step, m.rebase.total] : ['rebasingBare'])
      : ['mergingInto', m.theirs, currentBranch ?? 'HEAD'];
    const buttons = [];
    if (n) buttons.push({ action: 'resolve', label: 'resolve' });
    if (m.kind === 'rebase') {
      if (!n) buttons.push({ action: 'continue', label: 'rebaseContinue' });
      buttons.push({ action: 'skip', label: 'rebaseSkip' });
    }
    buttons.push({ action: 'abort', label: m.kind === 'conflicts' ? 'discardAllBtn' : 'abort' });
    return { what, todo, buttons };
  }

  const api = { mergeBanner };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiMergeBar = api;
})(typeof window !== 'undefined' ? window : globalThis);
