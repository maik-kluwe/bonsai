/**
 * Lane assignment for the commit graph.
 *
 * Expects commits in topo/date order (newest first, children before parents).
 * Returns, per row, the column of the commit dot and the line segments to draw.
 * y values: 0 = top edge of the row, 0.5 = middle (commit dot), 1 = bottom edge.
 */

export interface GraphInput {
  hash: string;
  parents: string[];
}

export interface Segment {
  x1: number;
  y1: 0 | 0.5;
  x2: number;
  y2: 0.5 | 1;
  color: number;
}

export interface GraphRow {
  col: number;
  color: number;
  segments: Segment[];
  /** Number of lanes occupied in this row (for the width). */
  width: number;
}

/** The webview draws at most this many lanes (media/main.js, graphSvg); everything further right is cut off. */
export const GRAPH_MAX_LANES = 24;

/** Removes segments lying entirely beyond the visible lanes. Saves most of the data for wide graphs. */
export function visibleRows(rows: GraphRow[], maxLanes = GRAPH_MAX_LANES): GraphRow[] {
  return rows.map(r => ({ ...r, segments: r.segments.filter(s => Math.min(s.x1, s.x2) < maxLanes) }));
}

export function computeGraph(commits: GraphInput[], palette = 8): { rows: GraphRow[]; maxWidth: number } {
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let nextColor = 0;
  let maxWidth = 0;
  const rows: GraphRow[] = [];

  const freeLane = (): number => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };
  const startLane = (k: number, hash: string) => {
    lanes[k] = hash;
    laneColor[k] = nextColor++ % palette;
  };

  for (const c of commits) {
    const segments: Segment[] = [];

    // Lanes that expect this commit.
    const incoming: number[] = [];
    lanes.forEach((h, k) => { if (h === c.hash) incoming.push(k); });

    let col: number;
    if (incoming.length) {
      col = incoming[0];
    } else {
      col = freeLane();
      startLane(col, c.hash); // branch tip: new lane, no line from above
    }

    // Upper half: passing-through lanes and converging lanes.
    lanes.forEach((h, k) => {
      if (h === null) return;
      if (h === c.hash) {
        if (incoming.length) segments.push({ x1: k, y1: 0, x2: col, y2: 0.5, color: laneColor[k] });
      } else {
        segments.push({ x1: k, y1: 0, x2: k, y2: 1, color: laneColor[k] });
      }
    });

    // Free converged lanes (except the commit lane).
    for (const k of incoming) if (k !== col) lanes[k] = null;

    const color = laneColor[col];

    // Lower half: parents.
    const [first, ...others] = c.parents;
    if (first !== undefined) {
      lanes[col] = first; // keep own lane → parallel lines, merge at the parent commit
      segments.push({ x1: col, y1: 0.5, x2: col, y2: 1, color });
    } else {
      lanes[col] = null; // root commit
    }

    for (const p of others) {
      let k = lanes.indexOf(p);
      if (k === -1) {
        k = freeLane();
        startLane(k, p);
      }
      segments.push({ x1: col, y1: 0.5, x2: k, y2: 1, color: laneColor[k] });
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    const width = Math.max(col + 1, lanes.length, ...segments.map(s => Math.max(s.x1, s.x2) + 1));
    maxWidth = Math.max(maxWidth, width);
    rows.push({ col, color, segments, width });
  }

  return { rows, maxWidth };
}
