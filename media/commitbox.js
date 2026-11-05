// Commit box rules. Runs in the webview (window.BonsaiCommitBox), in the host (require) and in the tests.
(function (root) {
  /** "subject\n\nbody" -> { subject, body }. The body is trimmed; a message without a newline has an empty body. */
  function splitMessage(message) {
    const [subject, ...rest] = message.split('\n');
    return { subject, body: rest.join('\n').trim() };
  }

  /** Inverse of splitMessage: subject, blank line, body. */
  function joinMessage(subject, body) {
    const b = body.trim();
    return subject.trim() + (b ? '\n\n' + b : '');
  }

  /**
   * Why a commit cannot happen right now, or null if it can. Host and webview ask the same question:
   * the webview disables the button, the host refuses the request.
   *  - During a rebase the commit box is out of play: Continue creates the commit.
   *  - Without a subject line there is nothing to commit with.
   *  - During a merge, open conflicts block; once they are resolved the commit is allowed even if the index
   *    equals HEAD (everything resolved with "ours").
   *  - Otherwise something must be staged, unless amending.
   * @param {{ message: string, amend: boolean, staged: number, merge?: { conflicts: number, kind?: string } }} s
   * @returns {null | 'rebasing' | 'noMessage' | 'conflicts' | 'nothingStaged'}
   */
  function commitBlocker(s) {
    if (s.merge?.kind === 'rebase') return 'rebasing';
    if (!splitMessage(s.message).subject.trim()) return 'noMessage';
    if (s.merge) return s.merge.conflicts > 0 ? 'conflicts' : null;
    if (!s.amend && s.staged === 0) return 'nothingStaged';
    return null;
  }

  /**
   * Pre-fills the message box with MERGE_MSG, once per merge, and takes it back when the merge ends
   * unless the user edited it. Knows nothing about the DOM: update() is told what is in the fields and
   * returns what to do with them.
   */
  function createPrefill() {
    let forHash = '';
    let text = '';
    const textOf = (subject, body) => (subject + '\n' + body).trim();
    return {
      /**
       * @param {{ hash: string, message: string } | undefined} merge the running merge, if any
       * @param {{ subject: string, body: string }} fields current content of the message box
       * @returns {{ subject: string, body: string } | null} new field content, or null to leave them alone
       */
      update(merge, fields) {
        if (!merge) {
          const clear = forHash !== '' && textOf(fields.subject, fields.body) === text;
          forHash = text = '';
          return clear ? { subject: '', body: '' } : null;
        }
        if (forHash === merge.hash) return null;
        forHash = merge.hash;
        text = '';
        if (fields.subject || fields.body || !merge.message) return null;
        const filled = splitMessage(merge.message);
        text = textOf(filled.subject, filled.body);
        return filled;
      },
    };
  }

  const api = { splitMessage, joinMessage, commitBlocker, createPrefill };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiCommitBox = api;
})(typeof window !== 'undefined' ? window : globalThis);
