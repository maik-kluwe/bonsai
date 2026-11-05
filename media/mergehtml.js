// The HTML of the merge dialog: the cards of the two sides, the grid with its checkboxes and the rows of the result. Runs in
// the webview (window.BonsaiMergeHtml) and in the tests; it only builds strings, main.js puts them on the page.
(function (root) {
  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, icons: { branch: string }, fmtDate: (date: any) => string }} deps
   *   t translates a text key; esc escapes for HTML; icons the inline SVGs (media/icons.js); fmtDate shows a date
   */
  function createMergeHtml({ t, esc, icons, fmtDate }) {
    /** Card at the top of a side: take-all checkbox, branch, last commit. */
    function card(/** @type {'ours' | 'theirs'} */ side, /** @type {string} */ name, /** @type {any} */ info) {
      const last = info?.hash ? `<div class="cmeta"><span class="mono">${esc(info.hash)}</span><span class="csub">${esc(info.subject)}</span><span>${fmtDate(info.date)}</span></div>` : '';
      return `<div class="mcard"><div class="chd"><input type="checkbox" class="mcb-all" data-side="${side}" title="${esc(t('takeSide', name))}">${icons.branch}<b>${esc(name)}</b></div>${last}</div>`;
    }

    /** The rows of the two sides, each for its own pane. A conflict gets its checkboxes on its first row; the shorter side is filled up. */
    function grids(/** @type {any[]} */ segments) {
      const cell = (/** @type {string} */ cb, /** @type {number | string} */ ln, /** @type {string} */ text, /** @type {string} */ cls, attr = '') =>
        `<div class="mc ${cls}">${cb}</div><div class="ml ${cls}">${ln}</div><div class="mt ${cls}"${attr}>${text}</div>`;
      let l = 1, r = 1, ci = 0, left = '', right = '';
      for (const s of segments) {
        if (s.t === 'text') {
          for (const line of s.lines) { left += cell('', l++, esc(line), ''); right += cell('', r++, esc(line), ''); }
          continue;
        }
        const rows = Math.max(1, s.theirs.length, s.ours.length);
        for (let i = 0; i < rows; i++) {
          const cb = (/** @type {string} */ side) => i === 0 ? `<input type="checkbox" class="mcb" data-ci="${ci}" data-side="${side}">` : '';
          const hasT = i < s.theirs.length, hasO = i < s.ours.length;
          left += cell(cb('theirs'), hasT ? l++ : '', hasT ? esc(s.theirs[i]) : '', hasT || i === 0 ? 'side-theirs' : 'fill', i === 0 ? ` data-cstart="${ci}"` : '');
          right += cell(cb('ours'), hasO ? r++ : '', hasO ? esc(s.ours[i]) : '', hasO || i === 0 ? 'side-ours' : 'fill');
        }
        ci++;
      }
      return `<div class="mside"><div class="mgrid">${left}</div></div><div class="mside"><div class="mgrid">${right}</div></div>`;
    }

    /**
     * The whole dialog; the result, the counter and the buttons' states are filled in by main.js.
     * @param {{ path: string, segments: any[], ours: string, theirs: string, sides?: { ours?: any, theirs?: any } }} d
     */
    function dialog({ path, segments, ours, theirs, sides }) {
      return `<div class="mdlg">
      <div class="mhead"><b>${t('mergeDialogTitle')}</b><span class="mfile">${esc(path)}</span><span class="grow"></span>
        <button data-mact="close" title="${t('cancel')}">✕</button></div>
      <div class="mcards">${card('theirs', theirs, sides?.theirs)}${card('ours', ours, sides?.ours)}
        <div class="mnav"><span class="mcount" id="mcount"></span>
          <button data-mact="prev" title="${t('prevConflict')}">‹</button><button data-mact="next" title="${t('nextConflict')}">›</button></div></div>
      <div class="mtop">${grids(segments)}</div>
      <div class="mrhead"><b>${t('mergeResult')}</b><span class="grow"></span><button data-mact="edit" id="medit">${t('editResult')}</button></div>
      <div class="mres" id="mres"></div>
      <div class="mfoot"><span class="mhint" id="mhint"></span><span class="grow"></span>
        <button class="primary" data-mact="resolve" id="mresolve">${t('resolve')}</button><button data-mact="close">${t('cancel')}</button></div>
    </div>`;
    }

    /** The rows of the result: numbered lines, undecided conflicts without a number. */
    function result(/** @type {any[]} */ rows) {
      let n = 1, html = '';
      for (const r of rows) {
        html += 'conflict' in r
          ? `<div class="rl rconf" data-ci="${r.conflict}"><span class="ln"></span><span class="rt">${t('conflictRow')}</span></div>`
          : `<div class="rl ${r.side && 'side-' + r.side}"><span class="ln">${n++}</span><span class="rt">${esc(r.text)}</span></div>`;
      }
      return `<div class="mrows">${html}</div>`;
    }

    return { dialog, result };
  }

  const api = { createMergeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiMergeHtml = api;
})(typeof window !== 'undefined' ? window : globalThis);
