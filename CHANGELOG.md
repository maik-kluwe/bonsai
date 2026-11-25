# Changelog

## Unreleased

### Added
- Checking out with local changes asks what to do with them: leave them, stash and reapply, or discard. It says beforehand whether Git would refuse or conflict.
- Remote branches carry the logo of GitHub, GitLab, Bitbucket, Gitea or Codeberg.
- Dragging over lines of a diff marks them for "Stage lines", "Discard lines" and "Unstage lines".

### Changed
- Questions (names, choices, confirmations, apply stash) are asked in Bonsai's own windows instead of VS Code's boxes.
- With several repositories, Bonsai starts with the one of the open file, else the one of the first workspace folder.

### Fixed
- Long file names no longer stick out of the hint in the pull window.
- Two initials fit into the avatar circle.
- The counters at Local Changes, Pull and Push are readable in every theme.
- All buttons at the bottom of a window are the same size.

## 0.5.0 - 2026-11-21

### Added
- A double-click on a commit in the graph checks out the branch that points at it. With several branches on one commit a small menu asks which one.
- A `pre-push` hook is noticed: the Output panel opens and shows what the hook prints while it runs. When the hook refuses the push, its message is part of the error.

### Changed
- Pull skips the fetch when the remote was fetched in the last 20 seconds. The Fetch button always fetches.

### Fixed
- Links in the Activity popup are clickable, as in the push window.
- Moving the Bonsai tab to another window (or back) no longer resets the view. The chosen repository stays, and so do the filter, the selected commit, the scroll position, the tab (Commits or Local Changes) and the draft of the commit message.

## 0.4.0 - 2026-11-14

### Added
- Arrow keys move through the Unstaged and Staged lists and show each file's diff. Shift extends the selection.

### Changed
- File rows in the Commit and Changes tabs are as tall as in the Unstaged and Staged lists.

## 0.3.0 - 2026-11-11

### Added
- Changed pictures show in the diff instead of the note "binary file". PNG, JPG, GIF, WebP, BMP and ICO work in commits, stashes, merge commits and Local Changes (unstaged, staged and new files), also after a rename.
- Three ways to compare the old and the new picture: **Side by side**, **Swipe** (drag the line across the picture) and **Onion skin** (fade between the two with a slider). The mode you pick stays for the next picture.
- Both pictures shrink by the same factor to fit the pane, so a size difference stays visible. Under each picture: width, height and file size.
- A picture that exists on one side only is shown alone, labelled "created" or "removed".

### Notes
- Pictures over 8 MB are not loaded; the diff shows their size instead.
- SVG files keep their text diff.

## 0.2.2 - 2026-11-10

Release pipeline fix, no changes for users.
