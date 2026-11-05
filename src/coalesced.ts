/**
 * Wraps a read that must not run twice at once: a call during a run leads to exactly one more run afterwards, however
 * many calls came in, because the running one may already have read past what they are about.
 */
export function coalesced(run: () => Promise<void>): () => Promise<void> {
  let running = false;
  let again = false;
  return async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; await run(); } while (again);
    } finally { running = false; }
  };
}
