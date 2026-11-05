// The push dialog as in Fork: which branch, where to, and how; plus the window with what the server answered, because
// that is where GitLab puts the link for a merge request. Runs in the webview (window.BonsaiPushDialog) and in the tests.
(function (root) {
  /**
   * Where a branch can go. With an upstream that comes first as "default"; without one the branch of the same name
   * as a new one on each remote. After that the branches that are on the remotes already.
   * @param {string} branch
   * @param {{ refs: any[], remotes?: string[] }} data
   * @returns {{ kind: 'default' | 'new' | 'existing', remote: string, branch: string }[]}
   */
  function targets(branch, { refs, remotes = [] }) {
    /** @returns {{ remote: string, branch: string } | undefined} */
    const split = (/** @type {string} */ name) => {
      const remote = remotes.find(r => name.startsWith(`${r}/`));
      return remote ? { remote, branch: name.slice(remote.length + 1) } : undefined;
    };
    const upstream = refs.find(r => r.kind === 'head' && r.name === branch)?.upstream;
    const parts = upstream ? split(upstream) : undefined;
    const first = parts ? [{ kind: /** @type {const} */ ('default'), ...parts }]
      : remotes.map(remote => ({ kind: /** @type {const} */ ('new'), remote, branch }));
    const existing = refs.filter(r => r.kind === 'remote' && !r.name.endsWith('/HEAD')).map(r => split(r.name)).filter(p => p !== undefined)
      .map(p => ({ kind: /** @type {const} */ ('existing'), ...p }));
    return [...first, ...existing];
  }

  /** Text and links of what Git printed; a dot or bracket behind a link is not part of it. */
  function splitLinks(/** @type {string} */ text) {
    /** @type {{ text?: string, url?: string }[]} */
    const parts = [];
    let at = 0;
    for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const url = m[0].replace(/[.,;:!?)\]]+$/, '');
      if (m.index > at) parts.push({ text: text.slice(at, m.index) });
      parts.push({ url });
      at = m.index + url.length;
    }
    if (at < text.length) parts.push({ text: text.slice(at) });
    return parts;
  }

  /**
   * @param {{ t: (key: string, ...args: any[]) => string, esc: (s: string) => string, post: (m: any) => void, icons?: any }} deps
   *   t translates a text key; esc escapes for HTML; post sends a message to the host
   */
  function createPushDialog({ t, esc, post }) {
    /** @type {{ refs: any[], remotes?: string[] } | null} */
    let data = null;
    let branch = '';
    let target = 0;
    let track = true;
    let tags = false;
    let force = false;

    const list = () => (data ? targets(branch, data) : []);
    const label = (/** @type {{ kind: string, remote: string, branch: string }} */ x) => {
      const name = `${x.remote}/${x.branch}`;
      return x.kind === 'existing' ? name : t(x.kind === 'default' ? 'pushDefault' : 'pushNew', name);
    };
    /** Tracking only makes sense for a branch that has no upstream yet. */
    const canTrack = () => list()[0]?.kind === 'new';

    return {
      get isOpen() { return data !== null; },
      get canPush() { return !!branch && list().length > 0; },

      open(/** @type {string | undefined} */ current, /** @type {{ refs: any[], remotes?: string[] }} */ snapshot) {
        data = snapshot;
        branch = current ?? '';
        target = 0;
        track = true;
        tags = false;
        force = false;
      },

      close() { data = null; },

      setBranch(/** @type {string} */ name) { branch = name; target = 0; track = true; },
      setTarget(/** @type {number} */ index) { target = index; },
      setOption(/** @type {'track' | 'tags' | 'force'} */ name, /** @type {boolean} */ on) {
        if (name === 'track') track = on; else if (name === 'tags') tags = on; else force = on;
      },

      /** Sends the push; false when there is nothing to push. */
      push() {
        const to = list()[target];
        if (!branch || !to) return false;
        post({ type: 'push', branch, remote: to.remote, remoteBranch: to.branch, track: canTrack() && track, tags, force });
        this.close();
        return true;
      },

      html() {
        const heads = (data?.refs ?? []).filter(r => r.kind === 'head').map(r => r.name);
        const option = (/** @type {string} */ value, /** @type {string} */ text, /** @type {boolean} */ on) =>
          `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
        const check = (/** @type {string} */ name, /** @type {boolean} */ on, /** @type {string} */ text) =>
          `<label class="pcheck"><input type="checkbox" data-popt="${name}"${on ? ' checked' : ''}><span>${esc(text)}</span></label>`;
        return `<div class="sdlg">
      <div class="mhead"><b>Push</b><span class="grow"></span><button data-pact="close" title="${t('cancel')}">✕</button></div>
      <div class="shint">${t('pushHint')}</div>
      <div class="pform">
        <label for="pbranch">${t('pushBranch')}</label><select id="pbranch">${heads.map(n => option(n, n, n === branch)).join('')}</select>
        <label for="ptarget">${t('pushTo')}</label><select id="ptarget">${list().map((x, i) => option(String(i), label(x), i === target)).join('')}</select>
        <span></span><div class="pchecks">${canTrack() ? check('track', track, t('pushTrack')) : ''}${check('tags', tags, t('pushTags'))}${check('force', force, t('pushForce'))}</div>
      </div>
      <div class="mfoot"><span class="grow"></span>
        <button class="primary" data-pact="push"${list().length && branch ? '' : ' disabled'}>Push</button><button data-pact="close">${t('cancel')}</button></div>
    </div>`;
      },

      /** The window with what Git printed; links open in the browser. */
      resultHtml(/** @type {string} */ output) {
        const body = splitLinks(output).map(p => (p.url ? `<a href="#" data-url="${esc(p.url)}">${esc(p.url)}</a>` : esc(p.text ?? ''))).join('');
        return `<div class="sdlg">
      <div class="mhead"><b>${t('pushResult')}</b><span class="grow"></span><button data-pact="close" title="${t('pushClose')}">✕</button></div>
      <pre class="poutput">${body}</pre>
      <div class="mfoot"><span class="grow"></span><button class="primary" data-pact="close">${t('pushClose')}</button></div>
    </div>`;
      },
    };
  }

  const api = { createPushDialog, targets, splitLinks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonsaiPushDialog = api;
})(typeof window !== 'undefined' ? window : globalThis);
