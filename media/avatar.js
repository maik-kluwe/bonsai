// Avatars without a network: initials on a colour that depends on the author. Runs in the webview
// (window.BonsaiAvatar) and in the tests.
(function (root) {
  /** Number of colour classes (`h0` … `h23` in main.css). */
  const HUES = 24;

  /** "Ada Lovelace" -> "AL", "ada" -> "A", "" -> "?". First and last word only; works for letters beyond ASCII. */
  function initials(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = [...words[0]][0];
    const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
    return (first + last).toUpperCase();
  }

  /** Colour class number of an author: the same person keeps the same colour, whatever the case of the email. */
  function hue(key) {
    let h = 0;
    for (const ch of String(key).trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % HUES;
  }

  const api = { HUES, initials, hue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiAvatar = api;
})(typeof window !== 'undefined' ? window : globalThis);
