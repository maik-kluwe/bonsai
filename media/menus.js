// Context menu contents. Runs in the webview (window.BonsaiMenus) and in the tests.
(function (root) {
  /**
   * A menu is a list of items; the builders below decide which items exist for a given context, nothing else.
   *   { label, msg }  host message (a ToHost from src/protocol.ts), sent when the item is clicked
   *   { label, ui }   webview-local action: { name, arg }, run by main.js
   *   { label }       inert entry (e.g. "no previous messages")
   *   { head }        heading
   *   null            separator
   * Rendering, positioning and sending stay in main.js.
   */

  /** "origin/feat/x" -> "feat/x": the local branch Git creates (DWIM) when a remote branch is checked out. */
  const localBranchName = name => name.slice(name.indexOf('/') + 1);

  /**
   * @param {(key: string, ...args: any[]) => string} t translation function of the webview
   */
  function createMenus(t) {
    const send = (label, msg) => ({ label, msg });

    /** Stash (sidebar and graph row). */
    function stash({ index, name }) {
      const act = action => ({ type: 'stashAction', action, index, name });
      return [
        send(t('apply'), act('apply')),
        send(t('rename'), act('rename')),
        null,
        send(t('deleteEllipsis'), act('drop')),
      ];
    }

    /** Merge into the current branch; needs a branch to merge into and something other than itself. */
    const mergeEntry = (ref, currentBranch) =>
      currentBranch ? [send(t('mergeInto', currentBranch), { type: 'merge', ref })] : [];

    /** Ref in the sidebar. `index` is only needed for stashes; `currentBranch` enables "Merge into" and "Rebase onto"; `upstream`, `ahead`, `behind` and `gone` come from a local branch's RefInfo. */
    function ref({ kind, name, hash, index, currentBranch, upstream, ahead, behind, gone }) {
      if (kind === 'stash') return stash({ index, name });
      const other = (kind === 'head' || kind === 'remote') && name !== currentBranch && currentBranch;
      const merge = other ? [
        ...mergeEntry(name, currentBranch),
        send(t('rebaseOnto', currentBranch, name), { type: 'rebase', ref: name }),
        send(t('interactiveRebaseOnto', currentBranch, name), { type: 'interactiveRebaseOnto', ref: name }),
      ] : [];
      const group = items => (items.length ? [null, ...items] : []);
      const tracked = upstream && !gone;
      const current = kind === 'head' && name === currentBranch;
      const sync = kind === 'head' ? [
        // A diverged branch cannot fast-forward; the checked-out one has Pull
        ...(tracked && !current && behind && !ahead ? [send(t('fastForwardEntry', upstream), { type: 'fastForward', name })] : []),
        ...(tracked && current ? [send(t('pullEntry', upstream), { type: 'pullPrepare' })] : []),
        { label: t('pushEntry'), ui: { name: 'openPushDlg', arg: name } },
      ] : kind === 'tag' ? [send(t('pushEntry'), { type: 'pushTag', name })]
        : kind === 'remote' && currentBranch ? [send(t('pullIntoEntry', currentBranch), { type: 'pullInto', ref: name })] : [];
      const local = kind === 'head' ? [send(t('trackingEntry'), { type: 'setTracking', name }), send(t('renameEntry'), { type: 'renameBranch', name })] : [];
      // Git refuses to delete the checked-out branch, so it is not offered
      const type = { remote: 'deleteRemoteBranch', tag: 'deleteTag', head: name !== currentBranch ? 'deleteBranch' : '' }[kind];
      const del = type ? [send(t('deleteEntry'), { type, name })] : [];
      return [
        send(t('checkout'), { type: 'checkout', ref: kind === 'remote' ? localBranchName(name) : name }),
        send(t('createBranchHere'), { type: 'createBranchAt', hash }),
        send(t('createTagHere'), { type: 'createTagAt', hash }),
        ...group(sync),
        ...group(merge),
        ...group([...local, ...del]),
        null,
        send(t('copyName'), { type: 'copy', text: name }),
      ];
    }

    /**
     * What dropping a branch on another one offers. Merge and rebase act on the checked-out branch, so one of the
     * two has to be the current branch; it does not matter which one is dragged. Anything else (tags, stashes, the
     * same branch, two other branches, a detached HEAD) offers nothing, which also means: no drop target.
     * @param {{ source: { kind: string, name: string }, target: { kind: string, name: string }, currentBranch?: string }} c
     */
    function dropBranch({ source, target, currentBranch }) {
      const branch = r => r.kind === 'head' || r.kind === 'remote';
      if (!currentBranch || !branch(source) || !branch(target)) return [];
      const isCurrent = r => r.kind === 'head' && r.name === currentBranch;
      if (isCurrent(source) === isCurrent(target)) return [];
      const other = isCurrent(source) ? target : source;
      return [
        send(t('mergeBranchInto', other.name, currentBranch), { type: 'merge', ref: other.name }),
        send(t('rebaseOnto', currentBranch, other.name), { type: 'rebase', ref: other.name }),
      ];
    }

    /**
     * Non-stash commit in the graph. `branches` are the local branch names pointing at it, `parents` its parent
     * hashes, `head` the checked-out commit. Cherry-pick and revert need exactly one parent (a merge commit would
     * need a mainline, a root commit has no base); neither makes sense on HEAD itself for cherry-pick. Rebase and reset
     * move the current branch, so they need one and a target other than its tip.
     */
    function commit({ hash, subject, branches, parents, head, currentBranch }) {
      const isHead = hash === head;
      const replayable = parents.length === 1;
      // Merge the branch rather than the bare hash when one points here: better message ("Merge branch 'x'") and title
      const others = branches.filter(n => n !== currentBranch);
      const mergeCommit = others.length
        ? others.map(n => send(t('mergeBranchInto', n, currentBranch), { type: 'merge', ref: n }))
        : mergeEntry(hash, currentBranch);
      const ops = [
        ...(isHead || !currentBranch ? [] : [...mergeCommit, send(t('rebaseEntry', currentBranch), { type: 'rebase', ref: hash })]),
        // Interactive rebase starts at this commit (it is included), so HEAD itself makes sense, e.g. to reword it
        ...(replayable && currentBranch ? [send(t('interactiveRebaseEntry'), { type: 'interactiveRebase', hash })] : []),
        ...(replayable && !isHead ? [send(t('cherryPickEntry'), { type: 'cherryPick', hash })] : []),
        ...(replayable ? [send(t('revertEntry'), { type: 'revert', hash })] : []),
        ...(isHead || !currentBranch ? [] : [send(t('resetEntry', currentBranch), { type: 'reset', hash })]),
      ];
      return [
        ...branches.map(b => send(t('checkoutRef', b), { type: 'checkout', ref: b })),
        send(t('checkoutDetached'), { type: 'checkout', ref: hash }),
        send(t('createBranchHere'), { type: 'createBranchAt', hash }),
        send(t('createTagHere'), { type: 'createTagAt', hash }),
        ...(ops.length ? [null, ...ops] : []),
        null,
        // A merge commit has no single diff that format-patch could write
        ...(parents.length < 2 ? [send(t('savePatchEntry'), { type: 'savePatch', hash, subject })] : []),
        send(t('compareEntry'), { type: 'compareLocal', hash }),
        null,
        send(t('copyHash'), { type: 'copy', text: hash }),
        send(t('copyMessage'), { type: 'copy', text: subject }),
        send(t('copyCommitInfo'), { type: 'copyCommitInfo', hash }),
      ];
    }

    /** File in the commit details; `file` is a FileChange. */
    function detailFile({ hash, parent, file }) {
      return [
        send(t('openVsDiff'), { type: 'openDiff', hash, parent, ...file }),
        send(t('copyPath'), { type: 'copy', text: file.path }),
      ];
    }

    /**
     * File(s) in the local changes lists.
     * @param {{ which: 'staged' | 'unstaged', selected: { path: string, conflict: boolean }[], currentBranch?: string, theirs?: string, operation?: boolean }} c
     *   `selected` is the marked selection, which contains the right-clicked file; `operation`: a merge or the like is running.
     */
    function changes({ which, selected, currentBranch, theirs, operation }) {
      const paths = selected.map(f => f.path);
      const single = selected.length === 1 ? selected[0] : null;
      const n = paths.length > 1 ? ` (${paths.length})` : '';
      const onFiles = type => ({ type, paths });
      const fileActions = !single ? [] : [
        null,
        send(t('openInEditor'), { type: 'openFile', path: single.path }),
        send(t('openVsDiff'), { type: 'openChange', path: single.path, staged: which === 'staged' }),
        send(t('copyPath'), { type: 'copy', text: single.path }),
      ];
      // Git cannot stash unmerged files, and a stash in the middle of a merge or rebase would only get in its way
      const stash = operation ? [] : [{ label: paths.length === 1 ? t('stashOneFile') : t('stashFiles', paths.length), ui: { name: 'openStashDlg', arg: paths } }];
      if (which === 'staged') return [send(t('unstage') + n, onFiles('unstage')), ...stash, ...fileActions];

      // Conflicts exist only in the unstaged list: pick a side or resolve in the merge editor
      const conflicts = selected.every(f => f.conflict);
      const resolve = !conflicts ? [] : [
        ...(single ? [
          { label: t('mergeBtn'), ui: { name: 'openMergeDlg', arg: single.path } },
          send(t('mergeEditor'), { type: 'mergeEditor', path: single.path }),
        ] : []),
        send(t('resolveUsing', currentBranch ?? 'HEAD') + n, { type: 'resolveUsing', side: 'ours', paths }),
        send(t('resolveUsing', theirs ?? '') + n, { type: 'resolveUsing', side: 'theirs', paths }),
        null,
      ];
      return [...resolve, send(t('stage') + n, onFiles('stage')), send(t('discardChanges') + n, onFiles('discard')), ...stash, ...fileActions];
    }

    /** Dropdown next to the Stash button: apply one of the recent stashes, or save a snapshot. `stashes` are RefInfo of kind 'stash'. */
    function stashDropdown({ stashes }) {
      // "On main: msg" -> "msg" (label from the host); automatic "WIP on ..." names stay complete
      const label = s => s.name.startsWith('WIP ') ? s.name : s.label;
      const recent = [...stashes].sort((a, b) => a.index - b.index).slice(0, 10);
      return [
        { head: t('recentStashes') },
        ...(recent.length
          ? recent.map(s => send(label(s), { type: 'stashAction', action: 'apply', index: s.index, name: s.name }))
          : [{ head: t('noStashes') }]),
        null,
        send(t('saveSnapshot'), { type: 'action', action: 'snapshot' }),
      ];
    }

    /** Earlier commit messages for the message box; `messages` are { subject, message }. */
    function recentMessages({ messages }) {
      return messages.length
        ? messages.map(m => ({ label: m.subject, ui: { name: 'useMessage', arg: m.message } }))
        : [{ label: t('noRecent') }];
    }

    return { stash, ref, dropBranch, commit, detailFile, changes, stashDropdown, recentMessages };
  }

  const api = { createMenus, localBranchName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiMenus = api;
})(typeof window !== 'undefined' ? window : globalThis);
