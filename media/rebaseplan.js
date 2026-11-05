// Interactive rebase: from the user's choices to a todo list for `git rebase -i`. Runs in the dialog webview
// (window.BonsaiRebasePlan), in the host and in the tests.
(function (root) {
  /**
   * Entries are ordered oldest first, as in Git's todo list:
   *   { hash, subject, message, action, edited? }
   * `action` is one of ACTIONS; `message` is the full original message, `edited` the text the user typed for the
   * commit's new message (only used where a message is needed).
   *
   * Squash and fixup melt a commit into the closest kept commit before it (its "head"). Git would open an editor
   * for the combined message of a squash. The dialog already asks for that message, so the plan avoids the editor
   * altogether: every squash becomes a fixup, and a following `git commit --amend -F` sets the message. The same
   * goes for reword. That also keeps `rebase --continue` after a conflict free of editors.
   */
  const ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'];

  const melts = e => e.action === 'squash' || e.action === 'fixup';

  /** Indices of the entries that survive, and for each head the indices melted into it. */
  function groups(entries) {
    const out = [];
    entries.forEach((e, i) => {
      if (e.action === 'drop') return;
      if (melts(e) && out.length) out[out.length - 1].members.push(i);
      else out.push({ head: i, members: [] });
    });
    return out;
  }

  /** null if the plan can run, otherwise why not: 'nothingKept', 'firstMelts' or 'emptyMessage'. */
  function problem(entries) {
    const kept = entries.filter(e => e.action !== 'drop');
    if (!kept.length) return 'nothingKept';
    if (melts(kept[0])) return 'firstMelts';
    const info = analyse(entries);
    return info.some((x, i) => x.needsMessage && !messageOf(entries, i, x).trim()) ? 'emptyMessage' : null;
  }

  const messageOf = (entries, i, info) => entries[i].edited ?? info.defaultMessage;

  /**
   * Per entry: `needsMessage` (it is a head whose message has to be written: reword, or a squash melts into it) and
   * `defaultMessage` (its own message, plus the messages of the squashes that melt into it).
   */
  function analyse(entries) {
    const info = entries.map(e => ({ needsMessage: false, defaultMessage: e.message.trim() }));
    for (const g of groups(entries)) {
      const squashed = g.members.filter(i => entries[i].action === 'squash');
      info[g.head].needsMessage = entries[g.head].action === 'reword' || squashed.length > 0;
      info[g.head].defaultMessage = [g.head, ...squashed].map(i => entries[i].message.trim()).join('\n\n');
    }
    return info;
  }

  /**
   * @param {{ hash: string, message: string, action: string, edited?: string }[]} entries oldest first
   * @param {(n: number) => string} messagePath path of the file for the n-th message (n counts from 1)
   * @returns {{ todo: string, messages: string[] }} the todo text, and the message files to write (messages[n - 1])
   */
  function build(entries, messagePath) {
    const err = problem(entries);
    if (err) throw new Error(`Rebase plan is not valid: ${err}.`);
    const info = analyse(entries);
    const lastOfGroup = new Map(groups(entries).map(g => [g.members.length ? g.members[g.members.length - 1] : g.head, g.head]));
    const lines = [];
    const messages = [];
    entries.forEach((e, i) => {
      lines.push(`${e.action === 'drop' ? 'drop' : melts(e) ? 'fixup' : 'pick'} ${e.hash}`);
      const head = lastOfGroup.get(i);
      if (head !== undefined && info[head].needsMessage) {
        messages.push(messageOf(entries, head, info[head]).trim() + '\n');
        lines.push(`exec git commit --amend --allow-empty -F "${messagePath(messages.length)}"`);
      }
    });
    return { todo: lines.join('\n') + '\n', messages };
  }

  const api = { ACTIONS, groups, problem, analyse, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiRebasePlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
