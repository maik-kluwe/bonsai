// The diff of a changed picture: both sides side by side, one over the other behind a draggable line (Swipe), or faded
// into each other (Onion Skin), as in Fork. Runs in the webview (window.BonsaiImageDiff) and in the tests; `html` builds
// the string, `attach` makes it work (mode buttons, the line, the slider, the size read off the loaded picture).
(function (root) {
  /** The modes, with the key of the text on their button. */
  const MODES = /** @type {Record<string, string>} */ ({ side: 'imgSide', swipe: 'imgSwipe', onion: 'imgOnion' });

  /** "609 Bytes", "1,43 KB", "2,1 MB" */
  function formatBytes(/** @type {number} */ n, /** @type {string | undefined} */ locale) {
    const f = (/** @type {number} */ v) => v.toLocaleString(locale, { maximumFractionDigits: 2 });
    if (n < 1024) return `${n} Bytes`;
    return n < 1024 * 1024 ? `${f(n / 1024)} KB` : `${f(n / 1024 / 1024)} MB`;
  }

  /** Side by side, each picture sits in a frame with a margin, and the frames are a gap apart (media/main.css). */
  const FRAME = 16;
  const GAP = 32;
  /** The padding of `.imgdiff` on both sides (media/main.css). */
  const PADDING = 32;

  /**
   * By which factor both pictures shrink so that they fit into `available` pixels, the same for both so that their sizes
   * stay comparable. Side by side the pictures share the width with their frames and the gap; one over the other the
   * larger one counts. Never above 1: a small picture stays small. `widths` are the natural widths of the pictures shown.
   */
  function fitScale(/** @type {number[]} */ widths, /** @type {string} */ mode, /** @type {number} */ available) {
    if (!widths.length || !(available > 0)) return 1;
    const room = mode === 'side' ? available - FRAME * widths.length - GAP * (widths.length - 1) : available;
    const need = mode === 'side' ? widths.reduce((a, b) => a + b, 0) : Math.max(...widths);
    return need > 0 ? Math.min(1, Math.max(0.05, room / need)) : 1;
  }

  /** Where in the box (0 to 100 percent) a pointer at `x` is, for a box from `left` as wide as `width`. */
  const percentAt = (/** @type {number} */ x, /** @type {number} */ left, /** @type {number} */ width) =>
    width > 0 ? Math.min(100, Math.max(0, ((x - left) / width) * 100)) : 50;

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, locale?: string }} deps  t translates a text key
   */
  function createImageDiff({ t, locale }) {
    /** The mode of the last click; a diff drawn later starts in it. */
    let mode = 'side';

    /** A picture from the host is a data URL; nothing else is ever put into `src`. */
    const isPicture = (/** @type {string} */ url) => /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]*$/.test(url);

    const side = (/** @type {{ bytes: number, url?: string } | undefined} */ s, /** @type {string} */ cls) => {
      if (!s) return '';
      const body = s.url && isPicture(s.url) ? `<img src="${s.url}" alt="" draggable="false">` : `<div class="toolarge">${t('imgTooLarge', formatBytes(s.bytes, locale))}</div>`;
      return `<div class="pane ${cls}">${body}</div>`;
    };

    return {
      /**
       * The picture diff of `images` ({ old?, new? }), or '' when neither side has anything to show.
       * A picture that exists on one side only (created, removed) has no modes: there is nothing to compare.
       */
      html(/** @type {{ old?: any, new?: any } | undefined} */ images) {
        if (!images || (!images.old && !images.new)) return '';
        const both = !!(images.old && images.new);
        const captions = both ? { old: t('imgOld'), new: t('imgNew') } : images.old ? { old: t('imgRemoved') } : { new: t('imgCreated') };
        const cap = (/** @type {'old' | 'new'} */ k) => (k in captions ? `<span class="cap ${k}">${captions[k]}</span>` : '');
        const meta = (/** @type {'old' | 'new'} */ k) => (images[k] ? `<span class="meta ${k}" data-bytes="${images[k].bytes}">${formatBytes(images[k].bytes, locale)}</span>` : '');
        const modes = both
          ? `<div class="modes">${Object.entries(MODES).map(([m, key]) => `<button data-imgmode="${m}"${m === mode ? ' class="on"' : ''}>${t(key)}</button>`).join('')}</div>
             <input class="onion" type="range" min="0" max="100" value="100">`
          : '';
        return `<div class="imgdiff${both ? '' : ' single'}" data-mode="${both ? mode : 'side'}">
          <div class="box">
            <div class="caps">${cap('old')}${cap('new')}</div>
            <div class="stage">${side(images.old, 'old')}${side(images.new, 'new')}<div class="bar"></div></div>
            <div class="metas">${meta('old')}${meta('new')}</div>
          </div>
          ${modes}
        </div>`;
      },

      /** Makes every picture diff on the page work; once is enough, the diffs come and go below `doc`. */
      attach(/** @type {Document} */ doc) {
        /** The diff a node belongs to. */
        const diffOf = (/** @type {EventTarget | null} */ n) => (n instanceof Element ? /** @type {HTMLElement | null} */ (n.closest('.imgdiff')) : null);
        /** The swipe line is where the pointer is, as a share of the stage. */
        const swipeTo = (/** @type {HTMLElement} */ d, /** @type {PointerEvent} */ e) => {
          const r = /** @type {HTMLElement} */ (d.querySelector('.stage')).getBoundingClientRect();
          d.style.setProperty('--pos', `${percentAt(e.clientX, r.left, r.width)}%`);
        };
        let dragging = /** @type {HTMLElement | null} */ (null);

        /** Fits the pictures of a diff into the width it has now, once all of them are loaded. */
        const refit = (/** @type {HTMLElement} */ d) => {
          const imgs = [...d.querySelectorAll('img')];
          if (!imgs.length || imgs.some(i => !i.naturalWidth)) return;
          d.style.setProperty('--scale', String(fitScale(imgs.map(i => i.naturalWidth), d.dataset.mode ?? 'side', d.clientWidth - PADDING)));
        };
        // The pane is dragged wider or narrower, the window resized: the diff has other room now
        const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => { for (const e of entries) refit(/** @type {HTMLElement} */ (e.target)); });

        doc.addEventListener('click', e => {
          const b = e.target instanceof Element ? e.target.closest('[data-imgmode]') : null;
          if (!b) return;
          const picked = /** @type {HTMLElement} */ (b).dataset.imgmode ?? '';
          if (picked in MODES) mode = picked;
          for (const d of doc.querySelectorAll('.imgdiff:not(.single)')) {
            /** @type {HTMLElement} */ (d).dataset.mode = mode;
            for (const x of d.querySelectorAll('[data-imgmode]')) x.classList.toggle('on', /** @type {HTMLElement} */ (x).dataset.imgmode === mode);
            refit(/** @type {HTMLElement} */ (d));
          }
          e.stopPropagation();
        }, true);

        doc.addEventListener('pointerdown', e => {
          const d = diffOf(e.target);
          if (!d || d.dataset.mode !== 'swipe' || !(e.target instanceof Element) || !e.target.closest('.stage')) return;
          dragging = d;
          swipeTo(d, e);
          e.preventDefault();
        });
        doc.addEventListener('pointermove', e => { if (dragging) swipeTo(dragging, e); });
        const stop = () => { dragging = null; };
        doc.addEventListener('pointerup', stop);
        doc.addEventListener('pointercancel', stop);

        doc.addEventListener('input', e => {
          const d = diffOf(e.target);
          if (d && e.target instanceof Element && e.target.matches('input.onion')) d.style.setProperty('--op', String(Number(/** @type {HTMLInputElement} */ (e.target).value) / 100));
        });

        // A picture is loaded: now its size is known (the load event does not bubble, so it is caught on the way down)
        doc.addEventListener('load', e => {
          const img = e.target;
          if (!(img instanceof HTMLImageElement)) return;
          const d = diffOf(img);
          img.style.setProperty('--w', `${img.naturalWidth}px`);
          if (d) { refit(d); watcher?.observe(d); }
          const which = img.closest('.pane')?.classList.contains('old') ? 'old' : 'new';
          const meta = d?.querySelector(`.meta.${which}`);
          if (meta) meta.textContent = t('imgMeta', img.naturalWidth, img.naturalHeight, formatBytes(Number(/** @type {HTMLElement} */ (meta).dataset.bytes), locale));
        }, true);
      },
    };
  }

  const api = { createImageDiff, formatBytes, percentAt, fitScale };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiImageDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
