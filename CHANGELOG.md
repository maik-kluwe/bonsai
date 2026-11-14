# Changelog

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
