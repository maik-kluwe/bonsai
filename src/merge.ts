/** Labels with which `git merge-file` annotates the conflict markers (unique, so file content does not collide). */
export const LABEL_OURS = 'FV_OURS';
export const LABEL_BASE = 'FV_BASE';
export const LABEL_THEIRS = 'FV_THEIRS';

export type MergeSegment =
  | { t: 'text'; lines: string[] }
  | { t: 'conflict'; ours: string[]; base: string[]; theirs: string[] };

export interface ParsedMerge {
  segments: MergeSegment[];
  /** Line ending of the file (detected from "ours"). */
  eol: '\n' | '\r\n';
  /** Does the file end with a line break? */
  finalNewline: boolean;
}

/**
 * Splits the output of `git merge-file -p --diff3` into text blocks and conflicts.
 * Git has already merged non-overlapping changes; they are in the text blocks.
 */
export function parseMergeFile(text: string, eol: '\n' | '\r\n'): ParsedMerge {
  const finalNewline = text.endsWith('\n');
  const lines = text.split('\n').map(l => l.endsWith('\r') ? l.slice(0, -1) : l);
  if (finalNewline) lines.pop();

  const segments: MergeSegment[] = [];
  let plain: string[] = [];
  let state: 'text' | 'ours' | 'base' | 'theirs' = 'text';
  let cur = { ours: [] as string[], base: [] as string[], theirs: [] as string[] };
  const flushText = () => { if (plain.length) segments.push({ t: 'text', lines: plain }); plain = []; };

  for (const line of lines) {
    if (state === 'text' && line === `<<<<<<< ${LABEL_OURS}`) {
      flushText();
      cur = { ours: [], base: [], theirs: [] };
      state = 'ours';
    } else if (state === 'ours' && line === `||||||| ${LABEL_BASE}`) {
      state = 'base';
    } else if ((state === 'ours' || state === 'base') && line === '=======') {
      state = 'theirs';
    } else if (state === 'theirs' && line === `>>>>>>> ${LABEL_THEIRS}`) {
      segments.push({ t: 'conflict', ...cur });
      state = 'text';
    } else if (state === 'text') {
      plain.push(line);
    } else {
      cur[state].push(line);
    }
  }
  flushText();
  return { segments, eol, finalNewline };
}
