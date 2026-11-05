// Selection → file content for the merge dialog. Runs in the webview (window.BonsaiMergeResolve) and in the tests (require).
(function (root) {
  /** Join lines into file content; an empty list yields an empty file. */
  function joinLines(lines, eol, finalNewline) {
    return lines.length ? lines.join(eol) + (finalNewline ? eol : '') : '';
  }

  /**
   * Result of a conflict resolution: text blocks and conflicts from `git merge-file`, plus the choice per conflict
   * (theirs, ours or both, in the order they were chosen) or a hand-edited text.
   * @param {Array<{t: 'text', lines: string[]} | {t: 'conflict', ours: string[], theirs: string[]}>} segments
   * @param {{eol: string, finalNewline: boolean, ours: string, theirs: string}} opts line ending of the file and branch names for markers
   */
  function createResolution(segments, opts) {
    const total = segments.filter(s => s.t === 'conflict').length;
    const choice = Array.from({ length: total }, () => ({ ours: false, theirs: false, first: 'theirs' }));
    /** @type {string | null} */
    let manual = null;
    const startMarker = `<<<<<<< ${opts.ours}`, endMarker = `>>>>>>> ${opts.theirs}`;

    /** Sets one side of a conflict; the side that stays chosen longest comes first. */
    function pick(c, side, on) {
      const other = side === 'ours' ? 'theirs' : 'ours';
      c[side] = on;
      if (!on) c.first = other;
      else if (!c[other]) c.first = side;
    }

    /** The chosen sides of a conflict, in the order they go into the result. */
    const chosen = c => (c.first === 'ours' ? ['ours', 'theirs'] : ['theirs', 'ours']).filter(side => c[side]);

    /** Result as a list of lines; open conflicts appear with markers. */
    function lines() {
      const out = [];
      let ci = 0;
      for (const s of segments) {
        if (s.t === 'text') { out.push(...s.lines); continue; }
        const c = choice[ci++];
        if (c.theirs || c.ours) for (const side of chosen(c)) out.push(...s[side]);
        else out.push(startMarker, ...s.ours, '=======', ...s.theirs, endMarker);
      }
      return out;
    }

    return {
      segments,
      /** Number of conflicts. */
      total,
      choose(ci, side, on) { pick(choice[ci], side, on); },
      /** Select or deselect one side for all conflicts. */
      takeAll(side, on) { for (const c of choice) pick(c, side, on); },
      isChosen(ci, side) { return choice[ci][side]; },
      allChosen(side) { return total > 0 && choice.every(c => c[side]); },
      /** How many conflicts have at least one side. */
      done() { return choice.filter(c => c.ours || c.theirs).length; },
      lines,
      /**
       * Result for display: one row per result line (with its origin side) and a placeholder per open conflict.
       * @returns {Array<{text: string, side: '' | 'theirs' | 'ours'} | {conflict: number}>}
       */
      rows() {
        const out = [];
        let ci = 0;
        for (const s of segments) {
          if (s.t === 'text') { for (const text of s.lines) out.push({ text, side: '' }); continue; }
          const c = choice[ci++];
          if (!c.theirs && !c.ours) { out.push({ conflict: ci - 1 }); continue; }
          for (const side of chosen(c)) for (const text of s[side]) out.push({ text, side });
        }
        return out;
      },
      isManual() { return manual !== null; },
      manualText() { return manual ?? ''; },
      /** Edit by hand: starts with the current result (open conflicts with markers). */
      startManual() { manual = joinLines(lines(), '\n', opts.finalNewline); },
      /** Back to the selection; the hand-edited text is discarded. */
      endManual() { manual = null; },
      setManual(text) { manual = text; },
      /** Does the hand-edited text still contain one of our conflict markers? A lone `=======` line does not count (e.g. Markdown). */
      hasOpenMarkers() {
        return manual !== null && manual.split(/\r?\n/).some(l => l === startMarker || l === endMarker);
      },
      /** May the file be written? */
      canResolve() {
        return manual !== null ? !this.hasOpenMarkers() : this.done() === total;
      },
      /** File content with the file's line ending. */
      content() {
        return manual !== null ? manual.replace(/\r?\n/g, opts.eol) : joinLines(lines(), opts.eol, opts.finalNewline);
      },
    };
  }

  const api = { createResolution, joinLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiMergeResolve = api;
})(typeof window !== 'undefined' ? window : globalThis);
