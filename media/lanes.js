// Width calculation for the commit graph. Runs in the webview (window.BonsaiLanes) and in the tests (require).
(function (root) {
  /** Breite einer Lane in px. */
  const LANE_W = 12;
  /** Maximum number of drawn lanes (= GRAPH_MAX_LANES in src/graph.ts; the host sends only that many). */
  const MAX_LANES = 24;
  const MIN_LANES = 3;
  /** Space the subject column keeps at minimum. */
  const MIN_SUBJECT = 150;
  /** Minimum width of the main column (graph + subject), see .row in main.css. */
  const MIN_MAIN = 200;
  /** Fixed columns of the row (author 160 + hash 80 + date 140) plus right padding 8, see .row in main.css. */
  const FIXED_COLS = 160 + 80 + 140 + 8;
  /** Margin of the graph SVG to the right of the last lane. */
  const PAD = 6;

  /** How many lanes fit at this list width without squeezing out the commit message? */
  function visibleLanes(listWidth) {
    const mainW = Math.max(MIN_MAIN, listWidth - FIXED_COLS);
    return Math.max(MIN_LANES, Math.min(MAX_LANES, Math.floor((mainW - PAD - MIN_SUBJECT) / LANE_W)));
  }

  /**
   * Width of a row's SVG and column of the commit dot.
   * If the commit lies beyond the visible lanes, the dot is placed at the right edge (clamped).
   * @param {{width: number, col: number}} g
   * @param {number} maxLanes
   */
  function rowLayout(g, maxLanes) {
    return {
      width: Math.min(g.width, maxLanes) * LANE_W + PAD,
      col: Math.min(g.col, maxLanes - 1),
      clamped: g.col > maxLanes - 1,
    };
  }

  const api = { LANE_W, MAX_LANES, MIN_LANES, MIN_SUBJECT, MIN_MAIN, FIXED_COLS, PAD, visibleLanes, rowLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiLanes = api;
})(typeof window !== 'undefined' ? window : globalThis);
