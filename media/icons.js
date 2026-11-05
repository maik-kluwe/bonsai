// The icons of the view as inline SVG in one stroke style; fonts have no usable glyphs for them, and the content security
// policy allows no images from data: URLs. Runs in the webview (window.BonsaiIcons) and in the tests.
(function (root) {
  /** Icons as SVG in a uniform stroke style; fonts have no usable glyphs for them. */
  const svg = (/** @type {string} */ inner) =>
    `<svg class="ic" viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ICONS = {
    branch: svg('<circle cx="4" cy="3.5" r="1.7"/><circle cx="4" cy="12.5" r="1.7"/><circle cx="12" cy="5.5" r="1.7"/><path d="M4 5.2v5.6M12 7.2c0 2.6-8 1.4-8 3.6"/>'),
    remote: svg('<path d="M4.5 12.5h7a3 3 0 0 0 .4-6A4 4 0 0 0 4.2 7.2a2.65 2.65 0 0 0 .3 5.3z"/>'),
    // Filled and a size of its own: it sits on top of another icon, so the stroke style and the size of .ic do not fit
    goneTri: '<svg class="gone-tri" viewBox="0 0 10 9"><path d="M5 .5 9.7 8.7H.3z"/><rect x="4" y="4" width="2" height="3"/></svg>',
    tag: svg('<path d="M2.5 2.5v5l6.2 6.2 5-5-6.2-6.2z"/><circle cx="5.3" cy="5.3" r=".9"/>'),
    stash: svg('<rect x="2.5" y="3" width="11" height="3" rx=".6"/><path d="M3.5 6v6.5h9V6M6.5 9h3"/>'),
    // Repository as in Source Control: open book with a footer bar
    repo: svg('<path d="M4 2.5h8.5v11H5A1.5 1.5 0 0 1 3.5 12V3a.5.5 0 0 1 .5-.5z"/><path d="M3.5 12A1.5 1.5 0 0 1 5 10.5h7.5"/>'),
    folder: svg('<path d="M2 4.5v8h12V6H8L6.5 4.5z"/>'),
    folderOpen: svg('<path d="M2.5 12.5v-8h4L8 6h5v2M2.5 12.5l2-5h10l-2 5z"/>'),
    // Curved arrows as in Fork: fetch as outline, pull/push filled
    fetch: svg('<path d="M5 8H2.5L6 13.5 9.5 8H9C9 5 10 3.5 13 2.5 8 2.5 5 4 5 8z"/>'),
    pull: svg('<path fill="currentColor" d="M5 8H2.5L6 13.5 9.5 8H9C9 5 10 3.5 13 2.5 8 2.5 5 4 5 8z"/>'),
    push: svg('<path fill="currentColor" d="M11 8h2.5L10 2.5 6.5 8H7c0 3-1 4.5-4 5.5 5 0 8-1.5 8-5.5z"/>'),
    refresh: svg('<path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9M13.5 2.5v3.2h-3.2M13.5 8a5.5 5.5 0 0 1-9.4 3.9M2.5 13.5v-3.2h3.2"/>'),
    changes: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M8 5v4M6 7h4M6 11h4"/>'),
    commits: svg('<circle cx="8" cy="8" r="2.3"/><path d="M8 2v3.7M8 10.3V14"/>'),
    warn: svg('<path d="M8 2.2 14.3 13H1.7z"/><path d="M8 6.5v3.2M8 11.3v.2"/>'),
    up: svg('<path d="M8 13.5v-11M3.5 7 8 2.5 12.5 7"/>'),
    down: svg('<path d="M8 2.5v11M3.5 9 8 13.5 12.5 9"/>'),
    list: svg('<path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h6.5"/>'),
    history: svg('<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3M8 5v3.2l2 1.3"/>'),
    copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 3.5v-.3a.7.7 0 0 0-.7-.7H3.7a.7.7 0 0 0-.7.7v6.1a.7.7 0 0 0 .7.7h.3"/>'),
    wsShow: svg('<path d="M3 6.5v4h10v-4"/>'),
    eol: svg('<path d="M10.5 3v10M7.5 3v10M10.5 3H6.5a2.5 2.5 0 0 0 0 5h1"/>'),
    wrap: svg('<path d="M2.5 4h11M2.5 8h8.5a2.3 2.3 0 0 1 0 4.6H8.5M10 11l-1.6 1.6L10 14.2M2.5 12.6H5.5"/>'),
    iws: svg('<path d="M3 5.5h10M3 10.5h10M5 3l6 10"/>'),
    ctxLess: svg('<path d="M2 8h3.5M8 4h6M8 8h6M8 12h6"/>'),
    ctxMore: svg('<path d="M2 8h3.5M3.75 6.25v3.5M8 4h6M8 8h6M8 12h6"/>'),
    ctxAll: svg('<path d="M4 3v10M2 5l2-2 2 2M2 11l2 2 2-2M8 4h6M8 8h6M8 12h6"/>'),
    chevDown: svg('<path d="M4 6l4 4 4-4"/>'),
  };

  const api = { ICONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiIcons = api;
})(typeof window !== 'undefined' ? window : globalThis);
