// Dialog of the interactive rebase (webview). The list shows the newest commit on top, like the graph; the plan
// module (media/rebaseplan.js) works oldest first, so every call converts.
(function () {
  const vscode = acquireVsCodeApi();
  const P = window.BonsaiRebasePlan;
  const $ = id => document.getElementById(id);
  const ACTION_LABEL = { pick: 'Pick', reword: 'Reword', squash: 'Squash', fixup: 'Fixup', drop: 'Drop' };
  const TIP = { pick: 'irTipPick', reword: 'irTipReword', squash: 'irTipSquash', fixup: 'irTipFixup', drop: 'irTipDrop' };
  const ERROR = { nothingKept: 'irErrNothingKept', firstMelts: 'irErrFirstMelts', emptyMessage: 'irErrEmptyMessage' };

  let T = {};
  /** Newest first: { hash, subject, message, action, edited? } */
  let rows = [];
  let dragFrom = -1;

  const oldestFirst = () => rows.slice().reverse();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type !== 'init') return;
    T = m.t;
    rows = m.commits.slice().reverse().map(c => ({ ...c, action: 'pick' }));
    $('title').textContent = T.irTitle.replace('{0}', m.branch);
    $('help').textContent = T.irHelp;
    $('autostash-label').textContent = T.optAutostash;
    $('autostash').checked = m.dirty;
    $('start').textContent = T.irStart;
    $('cancel').textContent = T.irCancel;
    render();
  });

  function render(focus) {
    const info = P.analyse(oldestFirst()).reverse();
    $('rows').innerHTML = rows.map((r, d) => {
      const melts = r.action === 'squash' || r.action === 'fixup';
      const options = P.ACTIONS.map(a => `<option value="${a}" ${a === r.action ? 'selected' : ''}>${ACTION_LABEL[a]}</option>`).join('');
      const msg = info[d].needsMessage
        ? `<textarea data-d="${d}" rows="${Math.min(8, Math.max(2, (r.edited ?? info[d].defaultMessage).split('\n').length))}" aria-label="${esc(T.irMessage)}">${esc(r.edited ?? info[d].defaultMessage)}</textarea>`
        : '';
      return `<div class="row ${r.action}" data-d="${d}">
        <span class="handle" draggable="true" data-d="${d}">⋮⋮</span>
        <select data-d="${d}" title="${esc(T[TIP[r.action]])}">${options}</select>
        <span class="hash">${esc(r.hash.slice(0, 7))}</span>
        <span class="subject ${melts ? 'melts' : ''}" title="${esc(r.message)}">${melts ? '└ ' : ''}${esc(r.subject)}</span>
        <span class="moves">
          <button data-up="${d}" title="${esc(T.irUp)}" ${d === 0 ? 'disabled' : ''}>▲</button><button data-down="${d}" title="${esc(T.irDown)}" ${d === rows.length - 1 ? 'disabled' : ''}>▼</button>
        </span>
        ${msg ? `<div class="msg">${msg}</div>` : ''}
      </div>`;
    }).join('');
    if (focus !== undefined) $('rows').querySelector(`select[data-d="${focus}"]`)?.focus();
    validate();
  }

  function validate() {
    const problem = P.problem(oldestFirst());
    $('error').textContent = problem ? T[ERROR[problem]] : '';
    $('start').disabled = !!problem;
  }

  function move(from, to) {
    if (to < 0 || to >= rows.length || from === to) return;
    rows.splice(to, 0, ...rows.splice(from, 1));
    render();
  }

  const rowsEl = $('rows');
  rowsEl.addEventListener('change', e => {
    const el = e.target;
    if (el.tagName !== 'SELECT') return;
    const d = Number(el.dataset.d);
    rows[d].action = el.value;
    render(d);
  });
  rowsEl.addEventListener('input', e => {
    const el = e.target;
    if (el.tagName !== 'TEXTAREA') return;
    rows[Number(el.dataset.d)].edited = el.value;
    validate();
  });
  rowsEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.up !== undefined) move(Number(b.dataset.up), Number(b.dataset.up) - 1);
    if (b.dataset.down !== undefined) move(Number(b.dataset.down), Number(b.dataset.down) + 1);
  });

  rowsEl.addEventListener('dragstart', e => {
    const h = e.target.closest('.handle');
    if (!h) return;
    dragFrom = Number(h.dataset.d);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
  });
  rowsEl.addEventListener('dragover', e => {
    if (dragFrom < 0) return;
    e.preventDefault();
    for (const r of rowsEl.querySelectorAll('.row')) r.classList.remove('drop-above', 'drop-below');
    const row = e.target.closest('.row');
    if (row) row.classList.add(dropBelow(e, row) ? 'drop-below' : 'drop-above');
  });
  rowsEl.addEventListener('drop', e => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const row = e.target.closest('.row');
    if (row) {
      const d = Number(row.dataset.d);
      let to = dropBelow(e, row) ? d + 1 : d; // slot in the list as it is before the move
      if (dragFrom < to) to--;
      move(dragFrom, to);
    }
    dragFrom = -1;
  });
  rowsEl.addEventListener('dragend', () => {
    dragFrom = -1;
    for (const r of rowsEl.querySelectorAll('.row')) r.classList.remove('drop-above', 'drop-below');
  });
  const dropBelow = (e, row) => e.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;

  $('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  $('start').addEventListener('click', () => {
    const info = P.analyse(oldestFirst());
    vscode.postMessage({
      type: 'start',
      autostash: $('autostash').checked,
      entries: oldestFirst().map((r, i) => ({ hash: r.hash, action: r.action, ...(info[i].needsMessage && { edited: r.edited ?? info[i].defaultMessage }) })),
    });
  });

  vscode.postMessage({ type: 'ready' });
})();
