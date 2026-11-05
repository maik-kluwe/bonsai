// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const ROW_H = 24;
  // Width calculation of the graph, shared with the tests (media/lanes.js)
  const { LANE_W, visibleLanes, rowLayout } = /** @type {any} */ (window).BonsaiLanes;
  // Selection → file content in the merge dialog, shared with the tests (media/mergeresolve.js)
  const { createResolution } = /** @type {any} */ (window).BonsaiMergeResolve;
  // The merge dialog's state: opened file, resolution, current conflict, shared with the tests (media/mergedialog.js)
  const { createMergeDialog } = /** @type {any} */ (window).BonsaiMergeDialog;
  // The dialog that stashes chosen files, shared with the tests (media/stashdialog.js)
  const { createStashDialog } = /** @type {any} */ (window).BonsaiStashDialog;
  // The push dialog and the server's answer, shared with the tests (media/pushdialog.js)
  const { createPushDialog } = /** @type {any} */ (window).BonsaiPushDialog;
  // The commit list's and sidebar's state: data packet, selection, filters, groups, loading more, shared with the tests (media/nav.js)
  const { createNav, WORKTREE } = /** @type {any} */ (window).BonsaiNav;
  // Icons as inline SVG, shared with the tests (media/icons.js)
  const { ICONS } = /** @type {any} */ (window).BonsaiIcons;
  // HTML of a diff: hunks, marks, whitespace signs, shared with the tests (media/diffhtml.js)
  const { createDiffBody, esc } = /** @type {any} */ (window).BonsaiDiffHtml;
  const { createMergeHtml } = /** @type {any} */ (window).BonsaiMergeHtml;
  // Selection in the changes list, shared with the tests (media/selection.js)
  const { createSelection } = /** @type {any} */ (window).BonsaiSelection;
  // Commit box rules (message split/join, when commit is allowed, merge pre-fill), shared with the host (media/commitbox.js)
  const { splitMessage, joinMessage, commitBlocker, createPrefill } = /** @type {any} */ (window).BonsaiCommitBox;
  // Look of the diff toolbar and which answers still fit it, shared with the tests (media/look.js)
  const { createLook } = /** @type {any} */ (window).BonsaiLook;
  // The details pane's state: what was asked for, tabs, expanded files, fetched diffs, shared with the tests (media/details.js)
  const { createDetails } = /** @type {any} */ (window).BonsaiDetails;
  // The diff of the selected file in Local Changes: what is on screen, which answers replace it, staging messages, shared with the tests (media/localdiff.js)
  const { createLocalDiff, lineAction } = /** @type {any} */ (window).BonsaiLocalDiff;
  // Text and buttons of the banner of a running operation, shared with the tests (media/mergebar.js)
  const { mergeBanner } = /** @type {any} */ (window).BonsaiMergeBar;
  // Context menu contents as data, shared with the tests (media/menus.js)
  const { createMenus, localBranchName } = /** @type {any} */ (window).BonsaiMenus;
  // Marked lines inside a diff hunk, shared with the tests (media/linesel.js)
  const { createLineSelection } = /** @type {any} */ (window).BonsaiLineSel;
  const lineSel = createLineSelection();
  // Initials and colour of an author, shared with the tests (media/avatar.js)
  const { initials, hue } = /** @type {any} */ (window).BonsaiAvatar;
  const DOT_R = 3.5;
  const OVERSCAN = 10;

  /** Translations come from the host (German or English, depending on the VS Code language). */
  const L = JSON.parse(document.getElementById('i18n')?.textContent ?? '{}');
  const t = (/** @type {string} */ k, /** @type {any[]} */ ...a) => String(L[k] ?? k).replace(/\{(\d+)\}/g, (_, i) => String(a[Number(i)] ?? ''));

  const menus = createMenus(t);
  const diffBody = createDiffBody({ t, lineSel });
  const mergeHtml = createMergeHtml({ t, esc, icons: ICONS, fmtDate: (/** @type {any} */ d) => fmtDate(d) });

  /** The diff toolbar's look; the host keeps it (message saveLook / look) so it survives a reload. */
  const diffLook = createLook(/** @type {(m: any) => void} */ (m => vscode.postMessage(m)));
  const pane = createDetails({ post: /** @type {(m: any) => void} */ (m => vscode.postMessage(m)), look: diffLook });
  const nav = createNav({
    post: /** @type {(m: any) => void} */ (m => vscode.postMessage(m)), pane,
    saved: vscode.getState() ?? {}, save: /** @type {(st: any) => void} */ (st => vscode.setState(st)),
  });

  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
  const list = $('#list'), rowsEl = $('#rows'), spacer = $('#spacer');
  const refsEl = $('#refs'), details = $('#details'), menu = $('#menu'), errorEl = $('#error');
  const repoSel = /** @type {HTMLSelectElement} */ ($('#repo'));
  const filterEl = /** @type {HTMLInputElement} */ ($('#filter'));
  const refFilterEl = /** @type {HTMLInputElement} */ ($('#ref-filter'));
  const subjectEl = /** @type {HTMLInputElement} */ ($('#c-subject'));
  const bodyEl = /** @type {HTMLTextAreaElement} */ ($('#c-body'));
  const amendEl = /** @type {HTMLInputElement} */ ($('#c-amend'));

  const laneX = (/** @type {number} */ l) => l * LANE_W + LANE_W / 2 + 4;
  /** Graph rows: "Today"/"Yesterday" instead of a date. */
  const fmtRowDate = (/** @type {number} */ s) => {
    const d = new Date(s * 1000);
    const day = (/** @type {Date} */ x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(new Date()) - day(d)) / 86400000);
    if (diff === 0 || diff === 1) {
      return t(diff === 0 ? 'today' : 'yesterday') + ' ' + d.toLocaleTimeString(L._lang, { hour: '2-digit', minute: '2-digit' });
    }
    return fmtDate(s);
  };
  const fmtDate = (/** @type {number} */ s) => {
    const d = new Date(s * 1000);
    return d.toLocaleDateString(L._lang, { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(L._lang, { hour: '2-digit', minute: '2-digit' });
  };
  /** @param {HTMLElement} el @param {string} sel */
  const closest = (el, sel) => /** @type {HTMLElement | null} */ (el.closest(sel));

  // ---------- Messages from the extension host ----------

  window.addEventListener('message', e => {
    const m = e.data;
    switch (m.type) {
      case 'repos':
        repoSel.innerHTML = m.repos.map(r => `<option value="${esc(r.root)}" title="${esc(r.root)}" ${r.root === m.selected ? 'selected' : ''}>${esc(r.name)}</option>`).join('')
          || `<option>${t('noRepo')}</option>`;
        break;
      case 'data': {
        nav.receive(m);
        errorEl.hidden = true;
        renderToolbar();
        renderRefs();
        renderChanges();
        renderMerge();
        spacer.style.height = nav.data.commits.length * ROW_H + 'px';
        renderRows();
        showNewBranch();
        loadMoreIfNeeded(); // a short list that does not fill the panel never scrolls
        if (nav.detailsGone()) clearDetails();
        break;
      }
      case 'details': renderDetails(m.details); break;
      case 'look': diffLook.apply(m.look); break;
      case 'diff': { const update = local.receive(m, selection.target()); if (update && !update.unchanged) renderDiff(m, update.sameFile); break; }
      case 'recheck': local.load(selection.target()); break;
      case 'pushResult': showPushResult(m.output); break;
      case 'branchCreated': newBranch = m.name; showNewBranch(); break;
      case 'fileDiff': onFileDiff(m); break;
      case 'mergeInputs': onMergeInputs(m); break;
      case 'lastMessage': setMessage(m.message); break;
      case 'recentMessages': showRecent(m.messages); break;
      case 'activity': activity.update(m.entries); break;
      case 'committed':
        subjectEl.value = bodyEl.value = '';
        amendEl.checked = false;
        updateCommitBox();
        break;
      case 'error':
        nav.failed();
        details.classList.remove('pending');
        errorEl.textContent = m.message;
        errorEl.hidden = false;
        break;
    }
  });

  // ---------- Toolbar ----------

  function renderToolbar() {
    const head = nav.data.refs.find(r => r.kind === 'head' && r.name === nav.data.currentBranch);
    $('#ahead').textContent = head?.ahead ? String(head.ahead) : '';
    $('#behind').textContent = head?.behind ? String(head.behind) : '';
    const n = nav.data.changeCount ?? 0;
    $('#changes-count').textContent = n ? String(n) : '';
  }

  document.querySelectorAll('[data-action]').forEach(b =>
    b.addEventListener('click', () => {
      const { action } = /** @type {HTMLElement} */ (b).dataset;
      if (action === 'push') openPushDlg(); else vscode.postMessage({ type: 'action', action });
    }));
  // Stash dropdown: apply recent stashes, save snapshot
  $('#stash-menu').addEventListener('click', () => {
    const r = $('#stash-menu').closest('.split')?.getBoundingClientRect() ?? $('#stash-menu').getBoundingClientRect();
    showMenu(/** @type {any} */ ({ clientX: r.left, clientY: r.bottom + 2 }), menus.stashDropdown({ stashes: nav.data.refs.filter(x => x.kind === 'stash') }));
  });
  $('#refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  // Popup with what Bonsai did in this session (media/activity.js)
  const activity = /** @type {any} */ (window).BonsaiActivity.create({
    pop: $('#activity-pop'), button: $('#activity'), t, lang: L._lang, post: m => vscode.postMessage(m),
  });
  repoSel.addEventListener('change', () => vscode.postMessage({ type: 'selectRepo', root: repoSel.value }));
  filterEl.addEventListener('input', () => { nav.setFilter(filterEl.value); renderRows(); loadMoreIfNeeded(); });
  filterEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !nav.filter) return;
    const i = nav.findMatch(e.shiftKey);
    if (i >= 0) select(i, true);
  });

  // ---------- Views ----------

  function setView(/** @type {string} */ v) {
    nav.setView(v);
    $('#graph-view').hidden = v !== 'graph';
    $('#changes-view').hidden = v !== 'changes';
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', /** @type {HTMLElement} */ (n).dataset.view === v));
    if (v === 'graph') renderRows();
  }
  $('#nav').addEventListener('click', e => {
    const n = closest(/** @type {HTMLElement} */ (e.target), '.nav-item');
    if (n) setView(n.dataset.view ?? 'graph');
  });

  // ---------- Sidebar: refs as a tree ----------

  /**
   * Builds nested folders from "origin/feat/fe-13".
   * @param {any[]} refs
   */
  function buildTree(refs) {
    const root = { folders: new Map(), items: /** @type {any[]} */ ([]) };
    for (const r of refs) {
      // Stash: "On main: msg" → "msg" (label from the host, full text in the tooltip)
      const parts = r.kind === 'stash' ? [r.label] : r.name.split('/');
      let node = root;
      for (const p of parts.slice(0, -1)) {
        if (!node.folders.has(p)) node.folders.set(p, { folders: new Map(), items: [] });
        node = node.folders.get(p);
      }
      node.items.push({ ref: r, label: parts[parts.length - 1] });
    }
    return root;
  }

  /** @param {any} node @param {string} pathKey @param {number} depth */
  function renderNode(node, pathKey, depth) {
    const pad = (/** @type {number} */ d) => `style-pad="${d}"`;
    let html = '';
    for (const [name, child] of [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const key = `${pathKey}/${name}`;
      const open = nav.folderOpen(key);
      html += `<li class="folder ${open ? '' : 'collapsed'}"><div class="frow" data-key="${esc(key)}" ${pad(depth)}><span class="twisty">${ICONS.chevDown}</span><span class="ico"><span class="fi-closed">${ICONS.folder}</span><span class="fi-open">${ICONS.folderOpen}</span></span><span class="name">${esc(name)}</span></div><ul>${renderNode(child, key, depth + 1)}</ul></li>`;
    }
    for (const { ref: r, label } of node.items) {
      const cur = r.kind === 'head' && r.name === nav.data.currentBranch;
      const track = r.kind === 'head'
        ? `${r.ahead ? `<span class="ab" title="${t('aheadTip', r.ahead)}">${r.ahead}${ICONS.up}</span>` : ''}${r.behind ? `<span class="ab" title="${t('behindTip', r.behind)}">${r.behind}${ICONS.down}</span>` : ''}`
        : '';
      const tip = r.kind === 'stash' ? `stash@{${r.index}}: ${r.name}` : r.name + (r.upstream ? ' → ' + r.upstream : '');
      html += `<li class="ref ${cur ? 'current' : ''} ${r.kind === selectedRef?.kind && r.name === selectedRef.name ? 'sel' : ''}" data-hash="${r.hash}" data-name="${esc(r.name)}" data-kind="${r.kind}" data-index="${r.index ?? ''}" title="${esc(tip)}" ${draggable(r.kind)} ${pad(depth)}>
        <span class="ico">${refIcon(r, cur)}</span><span class="name">${esc(label)}</span>${track}</li>`;
    }
    return html;
  }

  /** A local branch whose remote branch was deleted: its upstream is still configured, but points at nothing. */
  const refIcon = (/** @type {any} */ r, /** @type {boolean} */ cur) =>
    r.gone ? `<span class="gone" title="${esc(t('goneTip', r.upstream))}">${icon(r.kind, cur)}${ICONS.goneTri}</span>` : icon(r.kind, cur);

  /** Branches can be dragged onto each other (see the end of this file); tags and stashes cannot. */
  const draggable = (/** @type {string} */ kind) => (kind === 'head' || kind === 'remote' ? 'draggable="true"' : '');

  /** Gravatar hashes whose picture does not exist (404): not asked for again on every redraw. */
  const noPicture = new Set();
  /** Round avatar of an author: initials, covered by the Gravatar picture when the user opted in and one exists. */
  function avatar(/** @type {string} */ name, /** @type {string} */ email) {
    const hash = nav.data.avatars?.[email.trim().toLowerCase()];
    const img = hash && !noPicture.has(hash) ? `<img src="https://gravatar.com/avatar/${hash}?s=36&d=404" data-hash="${hash}" alt="">` : '';
    return `<span class="av h${hue(email || name)}">${esc(initials(name))}${img}</span>`;
  }
  // An error does not bubble, hence the capture phase
  document.addEventListener('error', e => {
    const img = /** @type {HTMLElement} */ (e.target);
    if (img.tagName === 'IMG' && img.dataset.hash) { noPicture.add(img.dataset.hash); img.remove(); }
  }, true);

  /** The ref marked in the sidebar; the list is built anew on every refresh. */
  /** @type {{ kind?: string, name?: string } | null} */
  let selectedRef = null;
  /** A branch just created, until the data with it has arrived. */
  /** @type {string | null} */
  let newBranch = null;

  /** Opens the way to the new branch, marks it, and shows its commit when the graph is on screen. */
  function showNewBranch() {
    const ref = nav.data.refs.find((/** @type {any} */ r) => r.kind === 'head' && r.name === newBranch);
    if (!newBranch || !ref) return;
    nav.reveal('Branches', newBranch);
    selectedRef = { kind: 'head', name: newBranch };
    newBranch = null;
    renderRefs();
    refsEl.querySelector('.ref.sel')?.scrollIntoView({ block: 'nearest' });
    const i = nav.indexOf(ref.hash);
    if (nav.view === 'graph' && i !== undefined) select(i, true);
  }

  function renderRefs() {
    const groups = /** @type {[string, string][]} */ ([['Branches', 'head'], ['Remotes', 'remote'], ['Tags', 'tag'], ['Stashes', 'stash']]);
    refsEl.innerHTML = groups.map(([title, kind]) => {
      const refs = nav.refsOfKind(kind);
      if (nav.refFilter && !refs.length) return '';
      const open = nav.groupOpen(title);
      return `<div class="group ${open ? '' : 'collapsed'}"><div class="gtitle" data-key="${title}"><span class="chev">${ICONS.chevDown}</span>${title}</div>
        <ul>${renderNode(buildTree(refs), title, 1)}</ul></div>`;
    }).join('') || `<div class="none">${t('noMatches')}</div>`;
    // Indentation via CSSOM (CSP does not allow inline styles in the HTML string)
    refsEl.querySelectorAll('[style-pad]').forEach(el => {
      /** @type {HTMLElement} */ (el).style.paddingLeft = (18 + Number(el.getAttribute('style-pad')) * 10) + 'px';
    });
  }

  // Toolbar icons (HTML comes from the host): <span data-icon="branch">
  document.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = ICONS[/** @type {keyof typeof ICONS} */ (/** @type {HTMLElement} */ (el).dataset.icon)] ?? '';
  });

  const icon = (/** @type {string} */ kind, /** @type {boolean} */ cur) =>
    cur && kind === 'head' ? '✓' : ({ head: ICONS.branch, remote: ICONS.remote, tag: ICONS.tag, stash: ICONS.stash })[kind] ?? '';

  refFilterEl.addEventListener('input', () => { nav.setRefFilter(refFilterEl.value); renderRefs(); });

  refsEl.addEventListener('click', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    const toggle = closest(el, '.gtitle, .frow');
    if (toggle) {
      // everything is expanded while filtering
      if (nav.toggle(toggle.classList.contains('frow') ? 'folder' : 'group', toggle.dataset.key ?? '')) toggle.parentElement?.classList.toggle('collapsed');
      return;
    }
    const li = closest(el, '.ref');
    if (!li) return;
    refsEl.querySelectorAll('.ref.sel').forEach(x => x.classList.remove('sel'));
    li.classList.add('sel');
    selectedRef = { kind: li.dataset.kind, name: li.dataset.name };
    const i = nav.indexOf(li.dataset.hash ?? '');
    if (li.dataset.kind === 'stash' && i === undefined) { showStash(li.dataset.hash ?? ''); return; }
    if (i !== undefined) { setView('graph'); select(i, true); }
  });

  refsEl.addEventListener('dblclick', e => {
    const li = closest(/** @type {HTMLElement} */ (e.target), '.ref');
    if (!li) return;
    const { kind, name, index } = li.dataset;
    if (kind === 'head') vscode.postMessage({ type: 'checkout', ref: name });
    // Remote branch: Git creates a tracking branch via DWIM.
    if (kind === 'remote') vscode.postMessage({ type: 'checkout', ref: localBranchName(name) });
    if (kind === 'stash') vscode.postMessage({ type: 'stashAction', action: 'apply', index: Number(index), name });
  });

  refsEl.addEventListener('contextmenu', e => {
    const li = closest(/** @type {HTMLElement} */ (e.target), '.ref');
    if (!li) return;
    e.preventDefault();
    const { kind, name, hash, index } = li.dataset;
    const info = nav.data.refs.find(r => r.kind === kind && r.name === name);
    showMenu(e, menus.ref({ ...info, kind, name, hash, index: Number(index), currentBranch: nav.data.currentBranch }));
  });

  /** Show stash contents in the details pane (fallback when the base is not in the loaded log). */
  function showStash(/** @type {string} */ hash) {
    setView('graph');
    nav.showStash(hash);
    renderRows();
    details.className = 'loading';
    details.textContent = t('loading');
  }

  // ---------- Commit list (virtualized) ----------

  const matches = (/** @type {any} */ c) => nav.matches(c);

  function renderRows() {
    if (nav.view !== 'graph') return;
    const { commits, rows } = nav.data;
    const maxLanes = visibleLanes(list.clientWidth);
    const first = Math.max(0, Math.floor(list.scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(commits.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW_H) + OVERSCAN);
    rowsEl.style.transform = `translateY(${first * ROW_H}px)`;

    let html = '';
    for (let i = first; i < last; i++) {
      const c = commits[i], g = rows[i];
      const wt = c.hash === WORKTREE;
      const isHead = c.hash === nav.data.head;
      const stash = c.stash !== undefined;
      const badges = stash
        ? `<span class="badge-ref k-stash c${g.color}">${icon('stash', false)} stash@{${c.stash}}</span>`
        : nav.refsAt(c.hash).map(r => {
          const cur = r.kind === 'head' && r.name === nav.data.currentBranch;
          return `<span class="badge-ref k-${r.kind} ${cur ? 'current' : ''} c${g.color}" data-kind="${r.kind}" data-name="${esc(r.name)}" ${draggable(r.kind)}>${refIcon(r, cur)} ${esc(r.name)}</span>`;
        }).join('');
      html += `<div class="row ${wt ? 'worktree' : ''} ${i === nav.selected ? 'selected' : ''} ${matches(c) ? '' : 'dim'} ${isHead ? 'head' : ''}" data-i="${i}">
        <div class="main">
          <div class="graph">${graphSvg(g, c.parents.length > 1, isHead, wt, stash, maxLanes)}</div>
          <div class="subject">${badges}<span class="msg">${esc(c.subject)}</span></div>
        </div>
        <div class="author" title="${esc(c.email)}">${c.author ? avatar(c.author, c.email) : ''}<span class="an">${esc(c.author)}</span></div>
        <div class="hash">${wt ? '' : c.hash.slice(0, 7)}</div>
        <div class="date">${wt ? '' : fmtRowDate(c.date)}</div>
      </div>`;
    }
    rowsEl.innerHTML = html;
  }

  /** SVG for a row: lines (straight or curved) + commit dot. */
  function graphSvg(/** @type {any} */ g, /** @type {boolean} */ merge, /** @type {boolean} */ head, /** @type {boolean} */ wt, /** @type {boolean} */ stash, /** @type {number} */ maxLanes) {
    const { width: w, col, clamped } = rowLayout(g, maxLanes);
    let paths = '';
    for (const s of g.segments) {
      const x1 = laneX(s.x1), y1 = s.y1 * ROW_H, x2 = laneX(s.x2), y2 = s.y2 * ROW_H;
      const d = x1 === x2
        ? `M${x1} ${y1}L${x2} ${y2}`
        : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
      paths += `<path d="${d}" class="s c${s.color} ${wt ? 'dashed' : ''}"/>`;
    }
    // If the commit lies beyond the visible lanes, the dot stays visible at the right edge (dashed)
    const cx = laneX(col), cy = ROW_H / 2;
    const cls = (wt ? 'dot worktree' : stash ? 'dot stash' : merge ? 'dot merge' : `dot ${head ? 'head' : ''}`) + (clamped ? ' clamped' : '');
    const r = merge && !wt && !stash ? DOT_R - 1 : DOT_R;
    return `<svg width="${w}" height="${ROW_H}">${paths}<circle cx="${cx}" cy="${cy}" r="${r}" class="${cls} c${g.color}"/></svg>`;
  }

  let raf = 0;
  function loadMoreIfNeeded() {
    nav.loadMoreIfNeeded({ scrollTop: list.scrollTop, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, rowH: ROW_H });
  }
  list.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { renderRows(); loadMoreIfNeeded(); }); });
  new ResizeObserver(() => renderRows()).observe(list);

  function clearDetails() {
    pane.clear();
    details.className = 'empty';
    details.textContent = t('selectCommit');
  }

  function select(/** @type {number} */ i, /** @type {boolean} */ scroll) {
    const kind = nav.select(i);
    if (!kind) return;
    if (scroll) {
      const top = i * ROW_H;
      if (top < list.scrollTop || top + ROW_H > list.scrollTop + list.clientHeight) {
        list.scrollTop = top - list.clientHeight / 2;
      }
    }
    renderRows();
    // For a commit the old details stay, dimmed, until the answer arrives; the loading state would centre them in the meantime
    if (kind === 'worktree') { clearDetails(); details.textContent = t('worktreeHint'); }
    else details.classList.add('pending');
  }

  rowsEl.addEventListener('click', e => {
    const row = closest(/** @type {HTMLElement} */ (e.target), '.row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (nav.data.commits[i]?.hash === WORKTREE) { setView('changes'); return; }
    select(i, false);
    list.focus();
  });
  rowsEl.addEventListener('contextmenu', e => {
    const row = closest(/** @type {HTMLElement} */ (e.target), '.row');
    if (!row) return;
    e.preventDefault();
    const c = nav.data.commits[Number(row.dataset.i)];
    if (c.hash === WORKTREE) return;
    select(Number(row.dataset.i), false);
    if (c.stash !== undefined) { showMenu(e, menus.stash({ index: c.stash, name: c.subject })); return; }
    const branches = nav.refsAt(c.hash).filter(r => r.kind === 'head').map(r => r.name);
    showMenu(e, menus.commit({ hash: c.hash, subject: c.subject, branches, parents: c.parents, head: nav.data.head, currentBranch: nav.data.currentBranch }));
  });
  list.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { select(nav.target(1), true); e.preventDefault(); }
    if (e.key === 'ArrowUp') { select(nav.target(-1), true); e.preventDefault(); }
    if (e.key === 'Enter' && nav.onWorktree) setView('changes');
  });

  // ---------- Details ----------

  /** Buttons of the diff toolbar; iws adds ignoring whitespace. */
  function lookButtons(/** @type {boolean} */ iws) {
    const btn = (/** @type {string} */ id, /** @type {string} */ icon, /** @type {string} */ tip, /** @type {boolean} */ on, /** @type {boolean} */ off = false) =>
      `<button data-look="${id}" class="lk${on ? ' on' : ''}" title="${t(tip)}" aria-label="${t(tip)}" ${off ? 'disabled' : ''}>${ICONS[/** @type {keyof typeof ICONS} */ (icon)]}</button>`;
    return btn('ws', 'wsShow', 'diffShowWs', diffLook.value.ws) + btn('eol', 'eol', 'diffShowEol', diffLook.value.eol) + btn('wrap', 'wrap', 'diffWrap', diffLook.value.wrap)
      + (iws ? btn('iws', 'iws', 'diffIgnoreWs', diffLook.value.iws) : '')
      + btn('lessCtx', 'ctxLess', 'diffLessCtx', false, diffLook.value.ctx === 0)
      + btn('moreCtx', 'ctxMore', 'diffMoreCtx', false, diffLook.value.ctx === null)
      + btn('allCtx', 'ctxAll', 'diffAllCtx', diffLook.value.ctx === null);
  }

  function renderDetails(/** @type {any} */ d) {
    if (!pane.show(d, nav.data.refs.some(r => r.kind === 'stash' && r.hash === d.hash))) return;
    details.className = '';
    renderDetailsPane();
  }

  function renderDetailsPane() {
    const d = pane.current;
    const tab = (/** @type {string} */ id, /** @type {string} */ label) =>
      `<button data-tab="${id}" class="${pane.tab === id ? 'active' : ''}">${label}</button>`;
    const tabs = `<div class="dtabs">${tab('commit', t('tabCommit'))}${tab('changes', t('tabChanges'))}</div>`;
    const title = `<div class="ftitle">${d.files.length === 1 ? t('oneFile') : t('nFiles', d.files.length)}${d.parents.length > 1 && !d.isStash ? t('vsFirstParent') : ''}</div>`;
    if (pane.tab === 'changes') {
      details.innerHTML = `${tabs}<div class="dpane"><div class="files flist">${title}<ul></ul></div><div class="cdiff"><div class="ctool"></div><div class="cbody"></div></div></div>`;
      pane.enterChanges();
      renderChangesList();
      renderChangesDiff();
      return;
    }
    const stash = d.isStash ? nav.data.refs.find(r => r.kind === 'stash' && r.hash === d.hash) : undefined;
    const parents = d.parents.map((/** @type {string} */ p) => `<a class="hashlink" data-hash="${p}">${p.slice(0, 7)}</a>`).join(', ') || '–';
    details.innerHTML = `${tabs}<div class="dpane">
      <div class="meta">
        ${stash ? `<div class="kind">Stash · stash@{${stash.index}}</div>` : ''}
        <div class="subject-l">${esc(d.subject)}</div>
        ${d.body ? `<pre class="body">${esc(d.body)}</pre>` : ''}
        <table>
          <tr><th>${t('author')}</th><td>${avatar(d.author, d.email)}${esc(d.author)} &lt;${esc(d.email)}&gt;</td></tr>
          <tr><th>${t('authorDate')}</th><td>${fmtDate(d.date)}</td></tr>
          ${d.committer !== d.author ? `<tr><th>${t('committer')}</th><td>${esc(d.committer)} · ${fmtDate(d.committerDate)}</td></tr>` : ''}
          <tr><th>SHA</th><td><a class="hashlink copy" data-hash="${d.hash}" title="${t('copy')}: ${d.hash}">${d.hash.slice(0, 10)}${ICONS.copy}</a></td></tr>
          <tr><th>${t('parents')}</th><td>${parents}</td></tr>
        </table>
      </div>
      <div class="files wide">${title}<ul></ul></div></div>`;
    renderDetailFiles();
  }

  /** What shows a file's diff: the table of hunks, or a note while it loads, for a pure rename and so on. */
  function fileDiffHtml(/** @type {any} */ f, /** @type {Map<string, any>} */ diffs = pane.inlineDiffs, /** @type {any} */ look = null) {
    const d = diffs.get(f.path);
    if (!d) return `<div class="dmsg">${t('loading')}</div>`;
    if (!d.binary && !d.hunks.length && f.oldPath) return `<div class="dmsg">${esc(t('renamedOnly', f.oldPath, f.path))}</div>`;
    return diffBody(d, '', null, look);
  }

  /** Changes tab: the file list, the shown file marked. */
  function renderChangesList() {
    const ul = details.querySelector('.files ul');
    if (!ul || !pane.current) return;
    ul.innerHTML = pane.current.files.map((/** @type {any} */ f, /** @type {number} */ i) => fileLi(f, i, f.path === pane.changesPath ? 'active' : '')).join('');
  }

  /** Changes tab: the diff of the marked file. */
  function renderChangesDiff() {
    const box = details.querySelector('.cbody');
    const tool = details.querySelector('.ctool');
    if (!box || !tool || !pane.current) return;
    const f = pane.current.files.find((/** @type {any} */ f) => f.path === pane.changesPath);
    tool.innerHTML = `<span class="cname">${f ? esc(f.path) : ''}</span><span class="grow"></span>${lookButtons(true)}`;
    box.classList.toggle('wrap', diffLook.value.wrap);
    box.innerHTML = f ? fileDiffHtml(f, pane.changeDiffs, diffLook.value) : `<div class="dmsg">${t('selectFile')}</div>`;
  }

  /** File list in the details pane with an expandable inline diff under each file. */
  function renderDetailFiles() {
    const ul = details.querySelector('.files ul');
    if (!ul || !pane.current) return;
    const scroll = details.querySelector('.files')?.scrollTop ?? 0;
    ul.innerHTML = pane.current.files.map((f, i) => {
      const open = pane.openFiles.has(f.path);
      const body = !open ? '' : `<li class="inline-diff">${fileDiffHtml(f)}</li>`;
      return fileLi(f, i, `expandable ${open ? 'open' : ''}`) + body;
    }).join('');
    const files = details.querySelector('.files');
    if (files) files.scrollTop = scroll;
  }

  /** @param {any} f @param {number} i @param {string} cls */
  function fileLi(f, i, cls) {
    const dir = f.path.split('/').slice(0, -1).join('/');
    return `<li class="file ${cls}" data-i="${i}" title="${esc(f.oldPath ? f.oldPath + ' → ' + f.path : f.path)}">
      ${cls.includes('expandable') ? `<span class="twisty">${ICONS.chevDown}</span>` : ''}<span class="st st-${f.conflict ? 'X' : f.status}">${f.status}</span><span class="fname">${esc(f.path.split('/').pop())}</span><span class="fdir">${esc(dir)}</span></li>`;
  }

  function onFileDiff(/** @type {any} */ m) {
    const redraw = pane.onFileDiff(m);
    if (redraw === 'changes') renderChangesDiff();
    else if (redraw === 'files') renderDetailFiles();
  }

  details.addEventListener('click', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    const link = closest(el, '.hashlink');
    if (link) {
      if (link.classList.contains('copy')) vscode.postMessage({ type: 'copy', text: link.dataset.hash });
      else { const i = nav.indexOf(link.dataset.hash ?? ''); if (i !== undefined) select(i, true); }
      return;
    }
    const tabBtn = closest(el, '.dtabs button');
    if (tabBtn && pane.current) {
      if (pane.setTab(tabBtn.dataset.tab)) renderDetailsPane();
      return;
    }
    const lookBtn = closest(el, '.ctool button');
    if (lookBtn && pane.current) {
      pane.changeLook(lookBtn.dataset.look);
      renderChangesDiff();
      return;
    }
    const li = closest(el, '.file');
    if (!li || !pane.current) return;
    const f = pane.current.files[Number(li.dataset.i)];
    if (pane.tab === 'changes') {
      pane.pickChange(f.path);
      renderChangesList();
      renderChangesDiff();
      return;
    }
    // Expand/collapse the diff under the file; the VS Code diff is available via right-click
    pane.toggleFile(f.path);
    renderDetailFiles();
  });

  details.addEventListener('contextmenu', e => {
    const li = closest(/** @type {HTMLElement} */ (e.target), '.file');
    if (!li || !pane.current) return;
    e.preventDefault();
    showMenu(e, menus.detailFile({ hash: pane.current.hash, parent: pane.current.parents[0], file: pane.current.files[Number(li.dataset.i)] }));
  });

  // ---------- Merge in progress ----------

  const mergeBar = $('#mergebar');
  const prefill = createPrefill();

  /** Puts a full commit message into the subject and body fields. */
  function setMessage(/** @type {string} */ message) {
    const { subject, body } = splitMessage(message);
    subjectEl.value = subject;
    bodyEl.value = body;
    updateCommitBox();
  }

  function renderMerge() {
    const m = nav.data.merge;
    mergeBar.hidden = !m;
    const fill = prefill.update(m, { subject: subjectEl.value, body: bodyEl.value });
    if (fill) { subjectEl.value = fill.subject; bodyEl.value = fill.body; }
    if (!m) {
      if (fill) updateCommitBox();
      return;
    }
    const banner = mergeBanner(m, nav.data.currentBranch);
    const say = (/** @type {(string | number)[]} */ [key, ...args]) => t(String(key), ...args);
    mergeBar.innerHTML = `${ICONS.warn}<span>${esc(say(banner.what))} ${esc(say(banner.todo))}</span><span class="grow"></span>` +
      banner.buttons.map((/** @type {{action: string, label: string}} */ b) => `<button data-merge="${b.action}">${t(b.label)}</button>`).join('');
    updateCommitBox();
  }

  mergeBar.addEventListener('click', e => {
    const what = /** @type {HTMLElement} */ (e.target).dataset.merge;
    if (what === 'abort') vscode.postMessage({ type: 'mergeAbort' });
    else if (what === 'continue') vscode.postMessage({ type: 'rebaseContinue' });
    else if (what === 'skip') vscode.postMessage({ type: 'rebaseSkip' });
    else if (what === 'resolve') {
      // jump to the first conflict file
      const first = nav.data.unstaged.find(f => f.conflict);
      if (!first) return;
      setView('changes');
      local.load(selection.only('unstaged', first.path, nav.data));
      renderChanges();
    }
  });

  // ---------- Merge dialog (as in Fork: theirs left, ours right, result below) ----------

  const mergeDlg = $('#mergedlg');
  const dialog = createMergeDialog({ post: /** @type {(m: any) => void} */ (m => vscode.postMessage(m)), createResolution });
  const REASONS = { deleted: 'reasonDeleted', binary: 'reasonBinary', large: 'reasonLarge' };

  function openMergeDlg(/** @type {string} */ path) {
    dialog.open(path);
    mergeDlg.hidden = false;
    mergeDlg.innerHTML = `<div class="mdlg"><div class="mhead"><b>${t('mergeDialogTitle')}</b><span>${esc(path)}</span></div><div class="mload">${t('mergeLoading')}</div></div>`;
  }

  function closeMergeDlg() {
    dialog.close();
    mergeDlg.hidden = true;
    mergeDlg.innerHTML = '';
  }

  function onMergeInputs(/** @type {any} */ m) {
    const answer = dialog.receive(m, { ours: nav.data.currentBranch ?? 'HEAD', theirs: nav.data.merge?.theirs ?? '' });
    if ('stale' in answer) return;
    if ('refused' in answer) {
      closeMergeDlg();
      errorEl.textContent = t('mergeNA', t(REASONS[answer.refused]));
      errorEl.hidden = false;
      return;
    }
    buildMergeDlg();
    updateMergeDlg();
    showConflict(dialog.goTo(0));
  }

  function buildMergeDlg() {
    const d = /** @type {NonNullable<typeof dialog.state>} */ (dialog.state);
    mergeDlg.innerHTML = mergeHtml.dialog({
      path: d.path, segments: d.res.segments, ours: nav.data.currentBranch ?? 'HEAD', theirs: nav.data.merge?.theirs ?? '',
      sides: local.shown?.path === dialog.path ? local.shown?.sides : undefined,
    });
  }

  function updateMergeDlg() {
    const d = dialog.state;
    if (!d) return;
    const r = d.res, manual = r.isManual();
    mergeDlg.querySelectorAll('.mcb').forEach(el => {
      const cb = /** @type {HTMLInputElement} */ (el);
      cb.checked = r.isChosen(Number(cb.dataset.ci), /** @type {'ours' | 'theirs'} */ (cb.dataset.side));
      cb.disabled = manual;
    });
    mergeDlg.querySelectorAll('.mcb-all').forEach(el => {
      const cb = /** @type {HTMLInputElement} */ (el);
      cb.checked = r.allChosen(/** @type {'ours' | 'theirs'} */ (cb.dataset.side));
      cb.disabled = manual || !r.total;
    });
    const resEl = $('#mres');
    if (manual && d.view !== 'manual') {
      resEl.innerHTML = '<textarea class="mres-ta" spellcheck="false"></textarea>';
      /** @type {HTMLTextAreaElement} */ (resEl.firstChild).value = r.manualText();
      d.view = 'manual';
    } else if (!manual) {
      const { scrollTop, scrollLeft } = resEl;
      resEl.innerHTML = mergeHtml.result(d.res.rows());
      resEl.scrollTop = scrollTop;
      resEl.scrollLeft = scrollLeft;
      d.view = 'auto';
    }
    const ok = r.canResolve();
    const count = $('#mcount');
    count.textContent = manual ? '' : `${r.done()}/${r.total}`;
    count.className = 'mcount ' + (ok ? 'ok' : 'open');
    /** @type {HTMLButtonElement} */ ($('#mresolve')).disabled = !ok;
    $('#medit').textContent = manual ? t('backToSelection') : t('editResult');
    $('#mhint').textContent = manual ? t('mergeManualHint') : '';
  }

  /** Scrolls the grid to conflict `cur` (-1: there is none). */
  function showConflict(/** @type {number} */ cur) {
    const cell = cur >= 0 ? mergeDlg.querySelector(`[data-cstart="${cur}"]`) : null;
    const pane = cell?.closest('.mside');
    if (!cell || !pane) return;
    // Only up and down: scrollIntoView would also push a long line under the numbers
    const c = cell.getBoundingClientRect(), p = pane.getBoundingClientRect();
    pane.scrollTop += c.top - p.top - (pane.clientHeight - c.height) / 2;
  }

  /** Panes moved by the code below; their scroll event must not move the others back (a narrower pane stops short). */
  const movedPanes = new WeakSet();

  // As in Fork all three panes move sideways together, and the two sides up and down. Scroll events do not bubble.
  mergeDlg.addEventListener('scroll', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    const side = el.classList.contains('mside');
    if (!side && el.id !== 'mres') return;
    if (movedPanes.delete(el)) return;
    mergeDlg.querySelectorAll('.mside, #mres').forEach(pane => {
      if (pane === el) return;
      const { scrollTop, scrollLeft } = pane;
      pane.scrollLeft = el.scrollLeft;
      if (side && pane.id !== 'mres') pane.scrollTop = el.scrollTop;
      if (pane.scrollTop !== scrollTop || pane.scrollLeft !== scrollLeft) movedPanes.add(pane);
    });
  }, true);

  mergeDlg.addEventListener('change', e => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    const side = /** @type {'ours' | 'theirs'} */ (el.dataset.side);
    if (el.classList.contains('mcb')) dialog.choose(Number(el.dataset.ci), side, el.checked);
    else if (el.classList.contains('mcb-all')) dialog.takeAll(side, el.checked);
    else return;
    updateMergeDlg();
  });

  mergeDlg.addEventListener('input', e => {
    const el = /** @type {HTMLTextAreaElement} */ (e.target);
    if (!el.classList.contains('mres-ta')) return;
    dialog.setManual(el.value);
    updateMergeDlg();
  });

  mergeDlg.addEventListener('click', e => {
    const act = /** @type {HTMLElement} */ (e.target).dataset.mact;
    if (act === 'close') closeMergeDlg();
    else if (!dialog.state) return;
    else if (act === 'resolve') { if (dialog.resolve()) closeMergeDlg(); }
    else if (act === 'prev') showConflict(dialog.step(-1));
    else if (act === 'next') showConflict(dialog.step(1));
    else if (act === 'edit') {
      dialog.toggleManual();
      updateMergeDlg();
    }
  });

  // ---------- Local changes ----------

  /** Selected files and diff file of the two lists (media/selection.js); this file only renders and sends. */
  const selection = createSelection();

  /** @param {string} which */
  const filesOf = which => which === 'staged' ? nav.data.staged : nav.data.unstaged;

  function renderChanges() {
    selection.prune(nav.data);
    // After each refresh: keep the diff file, otherwise pick a successor
    const restored = selection.restore(nav.data);
    if (restored === 'clear') { local.forget(); diffEl.className = 'empty'; diffEl.textContent = t('selectFile'); }
    else local.load(restored);
    for (const which of /** @type {const} */ (['unstaged', 'staged'])) {
      const files = filesOf(which);
      const box = $('#' + which);
      /** @type {HTMLElement} */ (box.querySelector('.count')).textContent = String(files.length);
      /** @type {HTMLElement} */ (box.querySelector('ul')).innerHTML = files.length
        ? files.map((f, i) => fileLi(f, i, selection.has(which, f.path) ? 'selected' : '')).join('')
        : `<li class="none">${t('noChanges')}</li>`;
    }
    updateBulkButtons();
    updateCommitBox();
  }

  function updateBulkButtons() {
    for (const which of /** @type {const} */ (['unstaged', 'staged'])) {
      const n = selection.count(which);
      const b = /** @type {HTMLButtonElement} */ ($(`#${which} [data-bulk]`));
      b.disabled = n === 0;
      const label = which === 'staged' ? `↑ ${t('unstage')}` : `${t('stage')} ↓`;
      b.textContent = n > 1 ? `${label} (${n})` : label;
    }
  }

  const diffEl = $('#diff');
  const local = createLocalDiff({ post: /** @type {(m: any) => void} */ (m => vscode.postMessage(m)), look: diffLook, lineSel });

  /** Draws the diff `m` (an answer of the host, or the one on screen again); `sameFile` keeps the scroll position. */
  function renderDiff(/** @type {any} */ m, /** @type {boolean} */ sameFile) {
    const scroll = sameFile ? (diffEl.querySelector('.dbody')?.scrollTop ?? 0) : 0;
    diffEl.className = '';
    const name = m.path.split('/').pop(), dir = m.path.split('/').slice(0, -1).join('/');
    const hunkBtns = m.untracked ? '' : m.staged
      ? `<button data-hunk="unstage">${t('unstageHunk')}</button>`
      : `<button data-hunk="stage">${t('stageHunk')}</button><button data-hunk="discard">${t('discard')}</button>`;
    const st = statusOf(m);
    const pickLines = lineAction(m, st);
    const body = m.conflict ? conflictBody(m) : diffBody(m, hunkBtns, pickLines, diffLook.value);
    diffEl.innerHTML = `<div class="dhead">
        <span class="st st-${m.conflict ? 'X' : st}">${st}</span>
        <span class="fname">${esc(name)}</span><span class="fdir">${esc(dir)}</span>
        <span class="tag">${m.staged ? 'Staged' : 'Unstaged'}</span><span class="grow"></span>
        ${m.conflict ? '' : lookButtons(false)}
        <button data-file="open" title="${t('openTip')}">${t('open')}</button>
        ${m.conflict ? '' : `<button data-file="vsdiff" title="${t('vsDiffTip')}">${t('diffEditor')}</button>`}
      </div><div class="dbody${diffLook.value.wrap ? ' wrap' : ''}">${body}</div>`;
    const b = diffEl.querySelector('.dbody');
    if (b) b.scrollTop = scroll;
  }

  const CHANGE_KEY = { modified: 'chModified', added: 'chAdded', deleted: 'chDeleted' };

  /** Card for a merge side: branch, what it did to the file, last commit. Selected sides have a blue outline. */
  function sideCard(/** @type {string} */ name, /** @type {any} */ s, /** @type {boolean} */ picked) {
    const last = s.hash ? `<div class="cmeta"><span class="mono">${esc(s.hash)}</span><span class="csub">${esc(s.subject)}</span><span>${fmtDate(s.date)}</span></div>` : '';
    return `<div class="ccard${picked ? ' picked' : ''}"><div class="chd">${ICONS.branch}<b title="${esc(name)}">${esc(name)}</b><span class="grow"></span><span class="chg chg-${s.change}">${t(CHANGE_KEY[s.change])}</span></div>${last}</div>`;
  }


  /**
   * As in Fork: theirs left, ours right, checkboxes with lines to the action button.
   * Both ticked = merge (dialog) + merge in VS Code, only one = take that side, none = merge disabled.
   */
  function conflictBody(/** @type {any} */ m) {
    const pick = local.picked(m.path);
    const ours = nav.data.currentBranch ?? 'HEAD', theirs = nav.data.merge?.theirs ?? '';
    const any = pick.theirs || pick.ours;
    const cb = (/** @type {'ours' | 'theirs'} */ side) => `<input type="checkbox" class="cpick-cb ${side}" data-cside="${side}" ${pick[side] ? 'checked' : ''}>`;
    const row = m.sides
      ? `<div class="cpick">${sideCard(theirs, m.sides.theirs, pick.theirs)}
          <div class="clink">${cb('theirs')}${cb('ours')}${pick.theirs ? '<i class="hl l"></i>' : ''}${pick.ours ? '<i class="hl r"></i>' : ''}${any ? '<i class="vl"></i>' : ''}</div>
          ${sideCard(ours, m.sides.ours, pick.ours)}</div>`
      : '';
    const btns = !m.sides
      ? `<button data-file="mergeEditor" title="${t('mergeEditorTip')}">${t('mergeEditor')}</button>`
      : pick.theirs && pick.ours
        ? `<button data-file="merge" title="${t('mergeBtnTip')}">${t('mergeBtn')}</button><button data-file="mergeEditor" title="${t('mergeEditorTip')}">${t('mergeEditor')}</button>`
        : any
          ? `<button data-file="${pick.theirs ? 'resolveTheirs' : 'resolveOurs'}">${esc(t('chooseSide', pick.theirs ? theirs : ours))}</button>`
          : `<button disabled>${t('mergeBtn')}</button>`;
    return `<div class="dconf"><div class="ctitle">${ICONS.warn}${t('conflictTitle')}</div><div class="chint">${t('conflictHint')}</div>${row}<div class="cbtns">${btns}</div></div>`;
  }

  const statusOf = (/** @type {any} */ m) => filesOf(m.staged ? 'staged' : 'unstaged').find(f => f.path === m.path)?.status ?? '';

  /** The diff on screen is drawn again, e.g. after a mark or a toolbar click. */
  function redrawDiff() {
    const update = local.again(selection.target());
    if (update) renderDiff(local.shown, update.sameFile);
  }

  diffEl.addEventListener('click', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!local.shown) return;
    const lookBtn = closest(el, 'button[data-look]');
    if (lookBtn) {
      local.changeLook(lookBtn.dataset.look);
      redrawDiff();
      return;
    }
    if (el.dataset.file && local.fileAction(el.dataset.file) === 'merge') openMergeDlg(local.shown.path);
    const hunk = closest(el, '.hunk');
    if (el.dataset.hunk && hunk) local.hunk(Number(hunk.dataset.i), el.dataset.hunk);
    if (el.dataset.lines && hunk) {
      local.lines(Number(hunk.dataset.i), el.dataset.lines);
      redrawDiff(); // the marks are gone
      return;
    }
    // Mark changed lines; a drag that selected text is not a click on a line
    const row = closest(el, 'tr[data-l]');
    const e2 = /** @type {MouseEvent} */ (e);
    if (row && hunk && !(window.getSelection()?.toString() && !e2.shiftKey && !e2.ctrlKey && !e2.metaKey)) {
      local.mark(Number(hunk.dataset.i), Number(row.dataset.l), e2);
      redrawDiff();
    }
  });

  diffEl.addEventListener('change', e => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    const side = /** @type {'ours' | 'theirs' | undefined} */ (el.dataset.cside);
    if (!side || !local.shown) return;
    local.setPick(side, el.checked);
    redrawDiff();
  });

  /** Click selection as in the Explorer: plain, Ctrl/Cmd = toggle, Shift = range. */
  function clickFile(/** @type {'staged' | 'unstaged'} */ which, /** @type {number} */ i, /** @type {{shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean}} */ e) {
    local.load(selection.click(which, nav.data, i, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }));
    renderChanges();
  }

  const changesView = $('#changes-view');

  changesView.addEventListener('click', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    const box = closest(el, '.clist');
    if (!box) return;
    const which = box.id === 'staged' ? 'staged' : 'unstaged';
    const bulk = el.dataset.bulk;
    if (bulk) { vscode.postMessage({ type: bulk, paths: selection.paths(which) }); return; }
    const li = closest(el, '.file');
    if (!li) return;
    const i = Number(li.dataset.i);
    // Double-click = stage/unstage this file. Detected here via e.detail instead of a dblclick listener: the first
    // click re-renders the list, so the browser may not deliver dblclick for the replaced element.
    if (e.detail === 2 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      vscode.postMessage({ type: which === 'staged' ? 'unstage' : 'stage', paths: [filesOf(which)[i].path] });
      return;
    }
    clickFile(which, i, e);
  });

  changesView.addEventListener('keydown', e => {
    const box = closest(/** @type {HTMLElement} */ (e.target), '.clist');
    if (!box || !(e.key === 'a' && (e.ctrlKey || e.metaKey))) return;
    e.preventDefault();
    const which = box.id === 'staged' ? 'staged' : 'unstaged';
    selection.selectAll(which, nav.data);
    renderChanges();
    // The webview host triggers a native "select all" despite preventDefault and turns the whole page blue
    for (const ms of [0, 60, 200]) setTimeout(() => window.getSelection()?.removeAllRanges(), ms);
  });

  changesView.addEventListener('contextmenu', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    const box = closest(el, '.clist'), li = closest(el, '.file');
    if (!box || !li) return;
    e.preventDefault();
    const which = box.id === 'staged' ? 'staged' : 'unstaged';
    const f = filesOf(which)[Number(li.dataset.i)];
    // Right-click outside the selection selects only this file
    if (!selection.has(which, f.path)) clickFile(which, Number(li.dataset.i), {});
    const selected = selection.paths(which).map(p => filesOf(which).find(x => x.path === p)).filter(Boolean);
    showMenu(e, menus.changes({ which, selected, currentBranch: nav.data.currentBranch, theirs: nav.data.merge?.theirs, operation: !!nav.data.merge }));
  });

  function updateCommitBox() {
    const btn = /** @type {HTMLButtonElement} */ ($('#c-commit'));
    const blocker = commitBlocker(commitState());
    btn.disabled = blocker !== null;
    // Say why it is off; the same texts the host throws when a commit is refused
    btn.title = blocker ? t({ rebasing: 'errRebasing', noMessage: 'errNoMessage', conflicts: 'errConflicts', nothingStaged: 'errNothingStaged' }[blocker]) : '';
    btn.textContent = amendEl.checked ? 'Amend' : nav.data.staged.length ? `Commit (${nav.data.staged.length})` : 'Commit';
    const len = subjectEl.value.length;
    const lenEl = $('#c-len');
    lenEl.textContent = len ? String(len) : '';
    lenEl.classList.toggle('warn', len > 72);
  }
  function commitState() {
    return { message: joinMessage(subjectEl.value, bodyEl.value), amend: amendEl.checked, staged: nav.data.staged.length, merge: nav.data.merge };
  }
  function commit() {
    const state = commitState();
    if (commitBlocker(state)) return;
    vscode.postMessage({ type: 'commit', message: state.message, amend: state.amend });
  }
  subjectEl.addEventListener('input', updateCommitBox);
  amendEl.addEventListener('change', () => {
    if (amendEl.checked && !subjectEl.value && !bodyEl.value) vscode.postMessage({ type: 'lastMessage' });
    updateCommitBox();
  });
  $('#c-commit').addEventListener('click', commit);

  // Earlier commit messages as a dropdown below/above the button
  let recentPending = false;
  $('#c-recent').addEventListener('click', () => {
    recentPending = true;
    vscode.postMessage({ type: 'recentMessages' });
  });
  function showRecent(/** @type {string[]} */ messages) {
    if (!recentPending) return;
    recentPending = false;
    const r = $('#c-recent').getBoundingClientRect();
    const items = menus.recentMessages({ messages: messages.map(message => ({ subject: splitMessage(message).subject, message })) });
    showMenu(/** @type {any} */ ({ clientX: r.right, clientY: r.top }), items);
    menu.classList.add('recent');
    // right-aligned to the button, above it (the commit box sits at the bottom)
    menu.style.left = Math.max(4, r.right - menu.offsetWidth) + 'px';
    menu.style.top = Math.max(4, r.top - menu.offsetHeight - 2) + 'px';
  }
  for (const el of [subjectEl, bodyEl]) {
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } });
  }
  subjectEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); bodyEl.focus(); } });

  // ---------- Stash chosen files (as in Fork) ----------

  const stashDlg = $('#stashdlg');
  const stashDialog = createStashDialog({ t, esc, post: /** @type {(m: any) => void} */ (m => vscode.postMessage(m)) });

  function openStashDlg(/** @type {string[]} */ paths) {
    stashDialog.open(paths, nav.data);
    stashDlg.innerHTML = stashDialog.html();
    stashDlg.hidden = false;
    /** @type {HTMLElement} */ ($('#smsg')).focus();
  }
  function closeStashDlg() {
    stashDialog.close();
    stashDlg.hidden = true;
    stashDlg.innerHTML = '';
  }
  function saveStash() {
    if (stashDialog.save(/** @type {HTMLInputElement} */ ($('#smsg')).value)) closeStashDlg();
  }
  stashDlg.addEventListener('change', e => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!el.classList.contains('scb')) return;
    stashDialog.toggle(el.dataset.path ?? '', el.checked);
    /** @type {HTMLButtonElement} */ ($('#ssave')).disabled = !stashDialog.canSave;
  });
  stashDlg.addEventListener('click', e => {
    const act = closest(/** @type {HTMLElement} */ (e.target), '[data-sact]')?.dataset.sact;
    if (act === 'close') closeStashDlg();
    else if (act === 'save') saveStash();
  });
  stashDlg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).id === 'smsg') { e.preventDefault(); saveStash(); }
  });

  // ---------- Push (as in Fork) ----------

  const pushDlg = $('#pushdlg');
  const pushDialog = createPushDialog({ t, esc, post: /** @type {(m: any) => void} */ (m => vscode.postMessage(m)) });

  function showPushDlg() {
    pushDlg.innerHTML = pushDialog.html();
    pushDlg.hidden = false;
  }
  function openPushDlg(/** @type {string | undefined} */ branch = nav.data.currentBranch) {
    pushDialog.open(branch, nav.data);
    showPushDlg();
    /** @type {HTMLElement} */ (pushDlg.querySelector('[data-pact="push"]')).focus();
  }
  function closePushDlg() {
    pushDialog.close();
    pushDlg.hidden = true;
    pushDlg.innerHTML = '';
  }
  function showPushResult(/** @type {string} */ output) {
    pushDlg.innerHTML = pushDialog.resultHtml(output);
    pushDlg.hidden = false;
  }
  pushDlg.addEventListener('change', e => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (el.id === 'pbranch') { pushDialog.setBranch(el.value); showPushDlg(); }
    else if (el.id === 'ptarget') pushDialog.setTarget(Number(el.value));
    else if (el.dataset.popt) pushDialog.setOption(el.dataset.popt, el.checked);
  });
  pushDlg.addEventListener('click', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    const url = closest(el, '[data-url]')?.dataset.url;
    if (url) { e.preventDefault(); vscode.postMessage({ type: 'openUrl', url }); return; }
    const act = closest(el, '[data-pact]')?.dataset.pact;
    if (act === 'close') closePushDlg();
    else if (act === 'push' && pushDialog.push()) closePushDlg();
  });

  // ---------- Context menu ----------

  /** Webview-local menu actions (items of the form { label, ui: { name, arg } }). */
  const uiActions = {
    openPushDlg: (/** @type {string} */ branch) => openPushDlg(branch),
    openMergeDlg: (/** @type {string} */ path) => openMergeDlg(path),
    openStashDlg: (/** @type {string[]} */ paths) => openStashDlg(paths),
    useMessage: (/** @type {string} */ message) => { setMessage(message); subjectEl.focus(); },
  };

  /**
   * @param {MouseEvent} e
   * @param {any[]} items  from media/menus.js: null = separator, {head} = heading, {label, msg | ui}
   */
  function showMenu(e, items) {
    menu.classList.remove('recent');
    menu.innerHTML = items.map((it, i) => !it ? '<div class="msep"></div>'
      : 'head' in it ? `<div class="mhead">${esc(it.head)}</div>`
      : `<div class="mi" data-i="${i}">${esc(it.label)}</div>`).join('');
    menu.hidden = false;
    const { innerWidth: W, innerHeight: H } = window;
    menu.style.left = Math.min(e.clientX, W - menu.offsetWidth - 4) + 'px';
    menu.style.top = Math.min(e.clientY, H - menu.offsetHeight - 4) + 'px';
    menu.onclick = ev => {
      const mi = closest(/** @type {HTMLElement} */ (ev.target), '.mi');
      const it = mi ? items[Number(mi.dataset.i)] : null;
      if (it?.msg) vscode.postMessage(it.msg);
      else if (it?.ui) uiActions[it.ui.name](it.ui.arg);
      menu.hidden = true;
    };
  }
  window.addEventListener('mousedown', e => { if (!menu.contains(/** @type {Node} */ (e.target))) menu.hidden = true; });
  window.addEventListener('blur', () => { menu.hidden = true; });
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) menu.hidden = true;
    else if (stashDialog.isOpen) closeStashDlg();
    else if (!pushDlg.hidden) closePushDlg();
    else if (dialog.isOpen) closeMergeDlg();
  });

  // ---------- Drag and drop of branches ----------

  /** @type {{ kind: string, name: string } | null} */
  let dragged = null;

  /** The branch under the pointer: a sidebar entry, a badge in the graph, or the row of HEAD (the current branch). */
  function dropTarget(/** @type {HTMLElement} */ el) {
    const hit = closest(el, '.ref[data-kind], .badge-ref[data-kind]');
    if (hit) return { el: hit, ref: { kind: hit.dataset.kind ?? '', name: hit.dataset.name ?? '' } };
    const row = closest(el, '.row.head');
    return row && nav.data.currentBranch ? { el: row, ref: { kind: 'head', name: nav.data.currentBranch } } : null;
  }
  const dropMarks = () => document.querySelectorAll('.drop-ok').forEach(x => x.classList.remove('drop-ok'));
  /** Menu items for dropping the dragged branch on what is under the pointer; empty = not a drop target. */
  function dropItems(/** @type {DragEvent} */ e) {
    const target = dragged && dropTarget(/** @type {HTMLElement} */ (e.target));
    return dragged && target ? { target, items: menus.dropBranch({ source: dragged, target: target.ref, currentBranch: nav.data.currentBranch }) } : null;
  }

  document.addEventListener('dragstart', e => {
    const el = closest(/** @type {HTMLElement} */ (e.target), '[draggable="true"][data-kind]');
    if (!el || !e.dataTransfer) return;
    dragged = { kind: el.dataset.kind ?? '', name: el.dataset.name ?? '' };
    e.dataTransfer.effectAllowed = 'link';
    e.dataTransfer.setData('text/plain', dragged.name);
  });
  document.addEventListener('dragover', e => {
    const hit = dropItems(e);
    dropMarks();
    if (!hit?.items.length || !e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    hit.target.el.classList.add('drop-ok');
  });
  document.addEventListener('drop', e => {
    const hit = dropItems(e);
    dropMarks();
    dragged = null;
    if (!hit?.items.length) return;
    e.preventDefault();
    showMenu(e, hit.items);
  });
  document.addEventListener('dragend', () => { dragged = null; dropMarks(); });

  // ---------- Splitter ----------

  function drag(/** @type {HTMLElement} */ handle, /** @type {(e: MouseEvent) => void} */ onMove) {
    handle.addEventListener('mousedown', down => {
      down.preventDefault();
      document.body.classList.add('dragging');
      const up = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', up); document.body.classList.remove('dragging'); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', up);
    });
  }
  drag($('.splitter'), e => document.documentElement.style.setProperty('--sidebar-w', Math.max(160, Math.min(e.clientX, 500)) + 'px'));
  drag($('.vsplitter'), e => {
    const left = $('#changes-view').getBoundingClientRect().left;
    document.documentElement.style.setProperty('--cleft-w', Math.max(240, Math.min(e.clientX - left, 800)) + 'px');
  });
  drag($('.hsplitter'), e => {
    const rect = $('#center').getBoundingClientRect();
    document.documentElement.style.setProperty('--details-h', Math.max(80, Math.min(rect.bottom - e.clientY, rect.height - 80)) + 'px');
  });

  vscode.postMessage({ type: 'ready' });
})();
