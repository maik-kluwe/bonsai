# Developing Bonsai

How to build and test the extension and how each feature behaves in detail. The [README](../README.md) is the introduction for users.

## Getting started

```bash
npm install
make test
make build
```

The Makefile has three targets (it needs GNU Make; on Windows `winget install ezwinports.make` works):

| Target | What it does |
|---|---|
| `make test` | Compiles and runs all tests (`npm test`); the integration tests create temporary Git repos |
| `make build` | Runs the tests, then packages the extension into `build/bonsai-git-0.2.0.vsix` (`npm run package`). Install it with *Extensions: Install from VSIX…* |
| `make screenshots` | Retakes the README images in `images/`, see below. Needs a `make build` first |

Without Make: `npm run compile` compiles, `npm test` tests, `npm run package` packages.

To try the extension without installing it, open the folder in VS Code and press **F5** (Extension Development Host). Then run **Bonsai: Open Bonsai** from the Command Palette, use the button at the top of the Source Control view, or click **Bonsai** in the status bar at the bottom left.

### Scripts

| Script | Purpose |
|---|---|
| `scripts/make-icon.py` | Draws `media/icon.png` from the icon shapes, see below |
| `scripts/new-bonsai-testrepo.ps1` | Builds a test repo with CRLF, a long history, authors and merge conflicts, for trying things out by hand |
| `scripts/reload-vscode.ps1` | Reloads all open VS Code windows, e.g. after installing a fresh `.vsix` |
| `scripts/screenshots/` | Retakes the README images, see below |

PowerShell scripts need `-ExecutionPolicy Bypass` on a system that blocks scripts, e.g. `powershell -ExecutionPolicy Bypass -File scripts/reload-vscode.ps1`.

### README images

`scripts/screenshots/new-repo.ps1` builds a demo repo, `scripts/screenshots/take.ps1` starts a separate VS Code with a clean profile (it never touches your own window), drives it with mouse and keyboard and photographs it. Don't use the mouse or keyboard while it runs, that takes about a minute.

### Icon

`media/icon.svg` is the source and the editor tab icon. `python scripts/make-icon.py` draws the same shapes into `media/icon.png` (needs Pillow), which the extension manifest requires as PNG. Change both when the shapes change.

## Behaviour in detail

- **Repo selection** follows the selection in Source Control; pick one manually via the dropdown.
- **Graph** over all refs (`git log --all --date-order`), own lane computation (`src/graph.ts`), virtualized list. Dates show as "Today"/"Yesterday", otherwise absolute. How many lanes are visible depends on the panel width (3 to 24); the commit message keeps at least 150 px. A commit further to the right gets its dot as a dashed ring at the edge. `bonsai.maxCommits` is the page size: when the list is scrolled to within 40 rows of its end and the log was cut at its limit, the next page of that size is loaded (the limit grows; the log is read again from the top, so the order stays stable). While the filter box is in use, the rest of the history is loaded page by page, so the filter also finds old commits. With git/git, 20,000 commits run smoothly; all 85,988 are untested.
- **Avatars:** every author gets a round avatar in the graph and in the details: initials on a colour that depends on the email address (`media/avatar.js`), without any network access. Optionally (`bonsai.gravatar`, off by default) Gravatar pictures cover the initials. That sends the SHA-256 of each author email address to gravatar.com, and the page may then load images from there; authors without a picture keep their initials. The setting takes effect when Bonsai is reopened.
- **Drag and drop of branches:** drag a branch (sidebar entry or badge in the graph) onto another one, or onto the row of HEAD. If one of the two is the current branch, a menu offers "Merge 'x' into 'main'…" and "Rebase 'main' onto 'x'…" with the usual dialogs; any other pair is not a drop target. Tags and stashes cannot be dragged.
- **Activity:** the "Activity" button in the toolbar opens a popup with what Bonsai did in this session, newest first: one entry per action ("Stage 1 File", "Commit", "Merge" …) with time and result on the left, and on the right the Git commands it ran and what they printed (conflict messages and errors included). Only commands that change something are listed. Steps that go through the VS Code Git API (stage, commit, fetch, pull, push, checkout, stash) show no command line, because the API does not report one; the popup says so. A cancelled dialog leaves no entry. Auto-fetch is not logged, since VS Code runs it. The log lives until the window reloads and holds the last 100 entries.
- **Toolbar:** Fetch and Pull (dialogs as in Fork, see below), Push (also a dialog), Branch, Stash (with dropdown: apply recent stashes, save snapshot = stash and immediately apply again). Ahead/behind as a badge.
- **Sidebar:** branches (with ↑/↓; a yellow triangle on the branch icon, here and on the badge in the graph, marks a branch whose remote branch was deleted), remotes, tags, stashes as a folder tree (`origin/feat/fe-13` → origin › feat › fe-13), with a filter field. Folders are collapsed by default (the state is remembered); while filtering, folders with matches expand automatically. Click = jump to the commit, double-click = checkout (remote branch → tracking branch). Right-click → Delete: a local branch asks first and offers to delete its remote branch too; it warns when commits would be lost, counted as what no other ref reaches. A remote branch is deleted on the server. Commits offer Save as patch (`git format-patch`, not on merge commits), Compare with local changes (a multi-file diff, untracked files included) and Copy commit info (Git's medium format); branches and tags offer an interactive rebase onto them. Also on a right-click: Push (the dialog with that branch, on a tag a question for the remote), Pull on the checked-out branch, Fast-forward on another branch that is only behind its upstream (no checkout, Git refuses anything else), Pull into on a remote branch (fetch, then the merge dialog), Rename, Tracking (a pick list to remove the upstream or choose another remote branch), Create tag (lightweight, on branches and commits); a tag can be deleted locally or also on a remote.
- **Auto-fetch:** uses VS Code's own setting `git.autofetch` (interval `git.autofetchPeriod`). The view refreshes itself on every repo change.
- **Language:** German when VS Code's language is German, otherwise English (`src/i18n.ts`, `package.nls*.json`). Git terms stay in English.
- Filter (Enter / Shift+Enter jumps to the next/previous match), ↑/↓ to navigate.
- **Details pane:** the tabs "Commit" and "Changes" at the bottom of the graph view. The arrow at their right folds the pane down to the tab row (the setting is remembered); clicking a tab of a folded pane opens it. While no commit is selected, or the pane waits for its first answer, only the tab row shows, greyed out, with a short note, and the list gets the whole height.

### Local changes

They appear as a dashed row above HEAD and as an entry at the top of the sidebar. A click opens the Changes view. Unstaged and Staged are on the left; on the right is the diff of the selected file with hunk actions (stage, unstage, discard), Open, and VS Code diff. Single lines can be handled too: click a changed line to mark it (Ctrl/Cmd toggles, Shift marks a range within the hunk) and use "Stage lines", "Discard lines" or, in the staged diff, "Unstage lines" in the hunk header. Added, deleted and untracked files only offer whole hunks, since a single line has no second state to move to there. Below sits the commit box: subject, description, Amend, Ctrl/Cmd+Enter, and a list icon next to the subject that offers earlier commit messages for reuse.

Files can be multi-selected (Ctrl/Cmd, Shift, Ctrl/Cmd+A). "Stage" and "Unstage" above the list act on the selection; double-clicking a single file does the same for that file. Right-click: Discard, Open file, VS Code diff.

### Merge and conflicts

While a merge, cherry-pick or revert is waiting for conflicts (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`), a banner ("Merging branch 'x' into 'y'", "Cherry-picking commit 'x'", "Reverting commit 'x'") shows the number of open conflicts, with Resolve and Abort; Abort runs the matching `--abort`. The commit message is pre-filled from `MERGE_MSG`, and Commit is possible only at 0 conflicts.

A conflicted file shows two cards, theirs on the left, ours on the right. If you tick both, you get **Merge** (own dialog) and **Merge in VS Code**. With only one side ticked, the button reads "Choose <Branch>": the file is resolved with that side and staged, or removed if that side deleted it. Without a selection the button is disabled. The file's context menu offers the same.

The merge dialog shows theirs and ours side by side and the result below. Undisputed changes are merged by `git merge-file --diff3` itself, so the dialog lists only the real conflicts. You can jump between them, take one side per block, or edit the result by hand (while markers remain in it, "Resolve" stays disabled).

The dialog is not available for deleted sides, binary files, non-UTF-8 files, and files over 5000 lines; for those, "Choose" and "Merge in VS Code" remain. Mixed line endings are normalized in the dialog.

### Fetch and Pull

**Fetch** opens a small dialog: a remote and the box "Fetch all remotes" (ticked, the list is then off), as in Fork. It always prunes: remote branches that are gone on the server disappear here, too. The Git extension's `fetch` does the work, so stored sign-ins work.

**Pull** is two steps, because the dialog has to know what Git would say before it says it (`pullPrepare`, then `pull`):

1. `pullPrepare` fetches the upstream of the current branch with prune (the Git extension's `pull` does not prune, which left deleted remote branches in the graph) and reads `GitService.pullPreview`: how many commits are new, which files have tracked local changes, which of those the incoming commits touch (Git refuses a merge because of them; a rebase refuses any local change), and which of them would conflict once stashed and reapplied. The last one is worked out without touching anything: `git stash create` builds the stash commit and leaves it unreferenced, `git merge-tree --write-tree --merge-base=HEAD <upstream> <stash>` replays it onto the upstream. With diverged branches it reads the upstream tip, not the merge result, so it is a good guess rather than a promise; with unmerged files in the way there is no prediction at all. A branch without an upstream, or one whose upstream was deleted on the server, gets a message instead of a dialog.
2. The dialog (`media/pulldialog.js`) shows "From origin/main · Into main" and two boxes. It never ticks a box on its own: both start as the user left them at their last pull (kept in `globalState`, key `bonsai.pullChoice`, for all repositories, written when Pull is pressed, not when the dialog is cancelled). The first time, "Rebase instead of merge" follows `branch.<name>.rebase` / `pull.rebase` (only plain `true`; `merges` and `interactive` show as a merge) and the stash box is off. Under the boxes a line says what to expect: that the pull would be refused because of files with local changes, an expected conflict on the way back, or that the changes come back cleanly. Leaving the stash box off in a case that needs it only warns.
3. `pull` calls `GitService.integrate`: `git merge --no-edit [--autostash] <upstream>` or `git rebase [--autostash]`, no network, because step 1 has fetched. When the stash could not be reapplied, Git says so on stderr and exits 0, so unmerged files after an `--autostash` run count as a stop on conflicts. There is no running operation then and nothing to continue: the stash stays, the files are unmerged, and the generic "Unresolved conflicts" banner (below) shows them, as for any stash apply with conflicts. Every operation that stops on conflicts ends in `finish()`, which hands the files and Git's output to `Ui.conflicts`; the panel answers with a window of its own (`media/conflictdialog.js`: the files, Git's output folded away, "Resolve conflicts" switches to Local Changes). Windows without a panel behind them, such as the interactive rebase plan, fall back to a plain message box. The staged files are staged again afterwards, with the same rules as after a rebase.

The context menu entry "Pull <upstream>" on the checked-out branch opens the same dialog. "Pull into" on a remote branch (fetch, then the merge dialog) is a separate path.

When a call into the Git extension fails, its message is always "Failed to execute git". The error shown to the user is what Git printed (`apiErrorMessage`: stderr, else stdout, the last ten lines).

### Push

The Push button opens a dialog: branch (the current one first), target ("default" for the upstream, "new" per remote for a branch without one, then the branches already on the remotes), Create tracking reference (only without an upstream, ticked), Push all tags, Force push (`--force-with-lease`). Fork's "Custom…" target is not there yet.

Unlike the other toolbar actions, the push runs through the CLI, because the Git extension's `push` does not report what the server answered. `GIT_TERMINAL_PROMPT=0` keeps it from hanging on a prompt nobody can answer; when Git fails for lack of a sign-in (`isAuthFailure`), the push goes through the Git extension instead, which can ask, but without the server's answer and without tags. If the push created the remote branch and a `remote:` line has content, a window shows Git's whole output with clickable links; otherwise nothing opens. The Activity popup keeps the output either way.

### New branches

A branch created from the toolbar or a context menu is marked in the sidebar as soon as it is in the data; its group and the folders above it open, and in the graph view its commit gets selected. The mark in the sidebar now survives a refresh for every ref.

### Stashes and details

- **Stash chosen files:** right-click marked files in Unstaged or Staged, then "Stash n Files…". As in Fork, a dialog lists every changed file with the marked ones ticked, plus an optional message; a stash takes both the staged and the unstaged change of a file. It runs `git stash push -u -- <paths>`, so new files stay untracked. Staged deletions (also the old side of a rename) are unstaged first, because Git refuses paths that are gone from the index and, with `-u`, does so only after saving the stash; they come back as plain deletions. Git's index commit always holds the whole index, so staged changes of unticked files stay in place but are also part of the stash, and `stash apply --index` can fail on them; Bonsai's Apply does not use `--index`. The entry is hidden while a merge, cherry-pick, revert, rebase or unresolved conflict is running.
- **Stashes:** a click shows the contents (including untracked files). Clicking a file expands or collapses its diff below it, double-click = Apply, right-click = Apply, Rename, Delete (there is no Pop). Rename preserves the order (drop + store).
- **Commit details:** metadata and changed files (commits and stashes alike). A click expands or collapses the diff under the file, right-click opens the VS Code diff.
- **Context menu** on commits: Checkout, Create branch, Merge, Cherry-pick, Revert, copy hash/message. Merge is also in the sidebar menu of branches.
- **Merge, Cherry-pick, Revert:** a dry run (`git merge-tree`) names the files that would conflict before anything happens. Merge offers Default (fast-forward if possible), No fast-forward, Squash and Don't commit; with expected conflicts they still start (the banner with Resolve and Abort takes over). Two variants are refused in that case because Git leaves no marker behind to show or abort: Squash, and a Cherry-pick that does not commit. Cherry-pick offers "Commit the changes" and "Append origin", Revert asks whether to commit. They are offered only for commits with exactly one parent, and Cherry-pick not on HEAD itself.
- **Stash apply:** Apply asks, as Fork does, whether to delete the stash afterwards ("Delete stash after applying"); with conflicts the stash is always kept. Whenever merge, cherry-pick, revert, rebase or apply stops on conflicts, a dialog shows what Git printed, and the banner takes over.
- **Stash apply with conflicts:** Git leaves no marker for these (and none after a `git stash pop` in a terminal either), so any unmerged file without a running operation is shown as "Unresolved conflicts" with the same cards and the commit box blocked. The stash is kept. There is nothing for Git to abort, so the banner offers "Discard all changes" (`git reset --hard`, after a confirmation) instead of Abort: `reset --merge` would also drop staged changes that did not come from the stash.
- **Rebase:** "Rebase 'main' onto here…" in the commit menu (and "Rebase … onto 'x'…" in the branch menu) replays the current branch; the dialog offers `--autostash`, pre-ticked when tracked changes exist. Git brings an autostash back unstaged; Bonsai notes the staged files beforehand and stages them again when the rebase is over (also after a stop on conflicts, and after Abort). A file is only staged again if the rebase left it unchanged in HEAD; otherwise it stays unstaged, so that nothing the rebase brought in is staged as a revert. If anything goes wrong there, everything simply stays unstaged. There is no dry run, since every replayed commit can conflict. A stopped rebase uses the same banner as a merge ("Rebasing 'x', commit 2 of 5") with Resolve, Continue (when no conflict is left), Skip and Abort. The commit box is inactive during a rebase; Continue creates the commit with the message Git proposes.
- **Interactive rebase:** "Interactive rebase from here…" in the commit menu (the commit itself is included, so HEAD can be reworded too) opens a dialog of its own. It lists the commits up to HEAD, newest on top, with an action each (Pick, Reword, Squash, Fixup, Drop), reordering by drag or with the arrows, an editable message for every reword and every squash group, and the autostash checkbox. Start is blocked while the plan cannot work: nothing left, the oldest commit melting into nothing, an empty message. Git never opens an editor: a squash becomes a fixup, and a reword or squash group is followed by `git commit --amend -F`, so continuing after a conflict needs no editor either. The message files live in `.git/bonsai-rebase` until the rebase is done or aborted. Conflicts use the rebase banner above (its step counter counts the commits being replayed, not drops or the amends). Merge commits in the range are refused. The commit must be on the current branch and have exactly one parent.
- **Reset:** "Reset 'main' to here…" in the commit menu moves the current branch with Mixed (default), Soft or Hard. Hard asks for confirmation when tracked local changes would be lost (untracked files are not touched). The previous tip stays available as `ORIG_HEAD`.
