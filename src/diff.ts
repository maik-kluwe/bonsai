/** Parser for the `git diff` output of a single file (unified format). */

export interface DiffLine {
  /** ' ' context, '+' added, '-' removed, '\\' "No newline at end of file" */
  t: ' ' | '+' | '-' | '\\';
  text: string;
  o?: number; // old line number
  n?: number; // new line number
}

export interface Hunk {
  header: string;      // "@@ -1,4 +1,5 @@ func()"
  raw: string[];       // original lines incl. header, for patches
  lines: DiffLine[];
}

export interface ParsedDiff {
  fileHeader: string[]; // "diff --git …" up to the first "@@"
  hunks: Hunk[];
  binary: boolean;
}

export function parseDiff(raw: string): ParsedDiff {
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const fileHeader: string[] = [];
  const hunks: Hunk[] = [];
  let binary = false;
  let cur: Hunk | undefined;
  let o = 0, n = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      o = m ? Number(m[1]) : 0;
      n = m ? Number(m[2]) : 0;
      cur = { header: line, raw: [line], lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) binary = true;
      fileHeader.push(line);
      continue;
    }
    cur.raw.push(line);
    const t = line[0];
    const text = line.slice(1);
    if (t === '+') cur.lines.push({ t, text, n: n++ });
    else if (t === '-') cur.lines.push({ t, text, o: o++ });
    else if (t === '\\') cur.lines.push({ t, text: line });
    else cur.lines.push({ t: ' ', text, o: o++, n: n++ });
  }
  return { fileHeader, hunks, binary };
}

/** What a hunk says, without where it is: line numbers shift when an earlier hunk moves, the hunk stays the same. */
export const hunkBody = (h: Pick<Hunk, 'lines'>): string[] => h.lines.map(l => l.t + l.text);

/** Hunks are addressed by position, so a diff that changed after it was drawn could put another hunk there. `expect` is the body on screen. */
export function checkHunk(d: ParsedDiff, index: number, expect: string[]): void {
  const h = d.hunks[index];
  if (!h || JSON.stringify(hunkBody(h)) !== JSON.stringify(expect)) throw new Error('Hunk not found: the diff has changed.');
}

/** Patch containing only one hunk – for `git apply [--cached] [-R]`. */
export function hunkPatch(d: ParsedDiff, index: number): string {
  const h = d.hunks[index];
  if (!h) throw new Error('Hunk not found: the diff has changed.');
  return [...d.fileHeader, ...h.raw].join('\n') + '\n';
}

/**
 * Patch containing only the chosen changed lines of one hunk, for `git apply [--cached] [-R]`.
 * `selected` are indices into `hunk.lines`; anything that is not a changed line is ignored.
 *
 *  - 'forward' (stage): applied to the side the diff starts from. Unchosen removals stay as context,
 *    unchosen additions are left out.
 *  - 'reverse' (unstage, discard): applied with -R to the side the diff leads to. Unchosen additions stay
 *    as context, unchosen removals are left out.
 *
 * Added and deleted files have no second state to land on, so they are refused: use the hunk instead.
 */
export function linesPatch(d: ParsedDiff, index: number, selected: number[], direction: 'forward' | 'reverse'): string {
  const h = d.hunks[index];
  if (!h) throw new Error('Hunk not found: the diff has changed.');
  if (d.fileHeader.some(l => /^(new|deleted) file mode/.test(l))) {
    throw new Error('Lines of added or deleted files cannot be handled separately. Use the hunk instead.');
  }
  const chosen = new Set(selected.filter(i => h.lines[i]?.t === '+' || h.lines[i]?.t === '-'));
  if (!chosen.size) throw new Error('No changed line selected.');

  // Unchosen lines of this type stay as context, the other type disappears
  const keepAsContext = direction === 'forward' ? '-' : '+';
  const body: string[] = [];
  let oldCount = 0, newCount = 0;
  let dropped = false; // the previous line was left out
  h.lines.forEach((l, i) => {
    // "No newline at end of file" belongs to the line before it and shares its fate. That also holds for a
    // line turned into context: context comes from the side that is matched against the target.
    if (l.t === '\\') { if (!dropped) body.push(l.text); return; }
    dropped = false;
    if (l.t === ' ') { body.push(' ' + l.text); oldCount++; newCount++; return; }
    if (chosen.has(i)) { body.push(l.t + l.text); if (l.t === '+') newCount++; else oldCount++; }
    else if (l.t === keepAsContext) { body.push(' ' + l.text); oldCount++; newCount++; }
    else dropped = true;
  });

  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(h.header);
  if (!m) throw new Error('Unreadable hunk header.');
  // Only the side that is matched against the target decides where the hunk goes. An empty side (no context lines,
  // nothing to replace) names the line before the hunk, while Git places it by the other side, one further down.
  const start = Number(direction === 'forward' ? m[1] : m[2]);
  const other = (direction === 'forward' ? oldCount : newCount) === 0 ? start + 1 : start;
  const [oldStart, newStart] = direction === 'forward' ? [start, other] : [other, start];
  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${m[3]}`;
  return [...d.fileHeader, header, ...body].join('\n') + '\n';
}
