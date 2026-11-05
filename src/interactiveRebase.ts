import type { PlanEntry, RebaseCommit } from './gitService';

const { ACTIONS, problem } = require('../media/rebaseplan.js') as {
  ACTIONS: string[];
  problem(entries: PlanEntry[]): 'nothingKept' | 'firstMelts' | 'emptyMessage' | null;
};

/** What the dialog sends back for each commit. */
export interface Choice {
  hash: string;
  action: string;
  edited?: string;
}

/**
 * Combines the dialog's answer with the commits the host listed. The dialog is not trusted: it has to name exactly
 * the listed commits (in any order), every action has to be known, and the plan has to be valid. Subject and
 * message come from the host's list.
 * @throws Error naming what is wrong
 */
export function planEntries(commits: RebaseCommit[], chosen: Choice[]): PlanEntry[] {
  const byHash = new Map(commits.map(c => [c.hash, c]));
  if (chosen.length !== commits.length || new Set(chosen.map(c => c.hash)).size !== commits.length || chosen.some(c => !byHash.has(c.hash))) {
    throw new Error('The commits changed since the dialog was opened.');
  }
  const entries = chosen.map(c => {
    if (!ACTIONS.includes(c.action)) throw new Error(`Unknown action: ${c.action}.`);
    return { ...byHash.get(c.hash)!, action: c.action as PlanEntry['action'], ...(typeof c.edited === 'string' && { edited: c.edited }) };
  });
  const bad = problem(entries);
  if (bad) throw new Error(`Rebase plan is not valid: ${bad}.`);
  return entries;
}
