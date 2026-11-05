// The activity popup: what Bonsai did in this session, newest first, with the Git commands and what they
// printed. Webview only (window.BonsaiActivity); the entries are made in the host (src/activityLog.ts).
(function (root) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /**
   * @param {{ pop: HTMLElement, button: HTMLElement, t: (k: string, ...a: any[]) => string, lang: string, post: (m: any) => void }} o
   */
  function create({ pop, button, t, lang, post }) {
    /** @type {any[]} */
    let entries = [];
    /** @type {number | undefined} */
    let selectedId;

    const clock = ms => new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    const full = ms => new Date(ms).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'medium' });

    function render() {
      if (!entries.length) {
        pop.innerHTML = `<div class="act-empty">${esc(t('activityEmpty'))}</div>`;
        return;
      }
      const sel = entries.find(e => e.id === selectedId) ?? entries[0];
      const items = entries.map(e => `<div class="act-item${e.id === sel.id ? ' sel' : ''}${e.ok ? '' : ' failed'}" data-id="${e.id}">
        <div class="act-line"><span class="act-title">${esc(e.title)}</span><span class="act-time">${esc(clock(e.time))}</span></div>
        <div class="act-sub">${esc(e.subtitle ?? '')}</div></div>`).join('');
      pop.innerHTML = `<div class="act-list">${items}</div><div class="act-detail">${detail(sel)}</div>`;
      pop.querySelector('.act-item.sel')?.scrollIntoView({ block: 'nearest' });
    }

    function detail(e) {
      const when = t(e.ok ? 'activitySucceeded' : 'activityFailed', full(e.time));
      const cmds = e.commands.map(c => `<div class="act-cmd">$ ${esc(c.command)}</div>${c.output ? `<pre class="act-out${c.ok ? '' : ' bad'}">${esc(c.output)}</pre>` : ''}`).join('');
      // A failed command already shows its message above; the error is only new for steps without a command line
      const shown = e.commands.some(c => !c.ok && c.output);
      const err = e.error && !shown ? `<pre class="act-out bad">${esc(e.error)}</pre>` : '';
      const api = e.viaApi ? `<div class="act-note">${esc(t('activityApi'))}</div>` : '';
      return `<div class="act-head"><span class="act-title">${esc(e.title)}</span><span class="act-when${e.ok ? '' : ' bad'}">${esc(when)}</span></div>
        <div class="act-repo">${esc(e.repo)}${e.subtitle && e.ok ? ' · ' + esc(e.subtitle) : ''}</div>${cmds}${err}${api}`;
    }

    function open() {
      pop.hidden = false;
      post({ type: 'activity' });
      render();
    }
    const close = () => { pop.hidden = true; };

    button.addEventListener('click', () => (pop.hidden ? open() : close()));
    pop.addEventListener('click', e => {
      const item = /** @type {HTMLElement} */ (e.target).closest('.act-item');
      if (!item) return;
      selectedId = Number(/** @type {HTMLElement} */ (item).dataset.id);
      render();
    });
    document.addEventListener('mousedown', e => {
      const target = /** @type {Node} */ (e.target);
      if (!pop.hidden && !pop.contains(target) && !button.contains(target)) close();
    });
    document.addEventListener('keydown', e => {
      if (pop.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const i = Math.max(0, entries.findIndex(x => x.id === selectedId));
      const next = entries[Math.min(entries.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (!next) return;
      selectedId = next.id;
      render();
      e.preventDefault();
    });

    return {
      /** The host sends the whole log whenever it grows or the popup asks for it. */
      update(list) {
        const wasNewest = selectedId === undefined || selectedId === entries[0]?.id;
        entries = list;
        if (wasNewest) selectedId = entries[0]?.id;
        if (!pop.hidden) render();
      },
    };
  }

  root.BonsaiActivity = { create };
})(window);
