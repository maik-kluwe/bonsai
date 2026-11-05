import { createHash } from 'crypto';

/** What Gravatar looks an avatar up by: the SHA-256 of the trimmed, lower-cased email address. */
export const gravatarHash = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/**
 * Hashes for the distinct author emails, keyed by the trimmed, lower-cased email (the webview looks them up the
 * same way). Empty emails are left out. Only used when the user opted in to Gravatar: the hash is what leaves the machine.
 */
export function avatarHashes(authors: { email: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { email } of authors) {
    const key = email.trim().toLowerCase();
    if (key && !(key in out)) out[key] = gravatarHash(key);
  }
  return out;
}
