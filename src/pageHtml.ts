import { lang, strings, t } from './i18n';
import { MAIN_SCRIPTS, scriptTags } from './webviewAssets';

/** What the page needs from the host; the page itself knows nothing of VS Code, so the DOM tests can build it, too. */
export interface PageOptions {
  /** Lets the scripts through; a fresh one per page. */
  nonce: string;
  /** Where the webview may load styles from (`webview.cspSource`). */
  cspSource: string;
  /** Address of main.css. */
  css: string;
  /** Turns a file name of media/ into the address the webview loads it from. */
  uri: (file: string) => string;
  /** Allow Gravatar images (the user opted in). */
  gravatar: boolean;
}

/** The main view: toolbar, sidebar, graph, changes and the containers of the dialogs. */
export function pageHtml(o: PageOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource}; script-src 'nonce-${o.nonce}';${o.gravatar ? ' img-src data: https://gravatar.com https://*.gravatar.com;' : ' img-src data:;'}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${o.css}">
</head>
<body>
  <header class="toolbar">
    <span class="repo-pick"><span class="ico" data-icon="repo"></span><select id="repo" title="${t('repository')}"></select></span>
    <span class="sep"></span>
    <button data-action="fetch" title="${t('fetchTip')}"><span class="ico" data-icon="fetch"></span>Fetch</button>
    <button data-action="pull" title="Pull"><span class="ico" data-icon="pull"></span>Pull<span class="badge" id="behind"></span></button>
    <button data-action="push" title="Push"><span class="ico" data-icon="push"></span>Push<span class="badge" id="ahead"></span></button>
    <span class="sep"></span>
    <button data-action="branch" title="${t('newBranch')}"><span class="ico" data-icon="branch"></span>Branch</button>
    <span class="split">
      <button data-action="stash" title="${t('stashTip')}"><span class="ico" data-icon="stash"></span>Stash</button><button id="stash-menu" class="chev" title="${t('stashMenuTip')}"><span class="ico" data-icon="chevDown"></span></button>
    </span>
    <span class="grow"></span>
    <button id="activity" title="${t('activityTip')}"><span class="ico" data-icon="history"></span>${t('activity')}</button>
    <button id="refresh" title="${t('refresh')}"><span class="ico" data-icon="refresh"></span>${t('refresh')}</button>
    <input id="filter" type="search" placeholder="${t('filterCommits')}" title="${t('filterCommitsTip')}">
  </header>
  <div id="mergebar" hidden></div>
  <main>
    <aside id="sidebar">
      <nav id="nav">
        <div class="nav-item" data-view="changes"><span class="ico" data-icon="changes"></span>${t('navChanges')}<span class="count" id="changes-count"></span></div>
        <div class="nav-item active" data-view="graph"><span class="ico" data-icon="commits"></span>${t('navCommits')}</div>
      </nav>
      <input id="ref-filter" type="search" placeholder="${t('filterRefs')}">
      <div id="refs"></div>
    </aside>
    <div class="splitter"></div>
    <section id="center">
      <div id="graph-view" class="view">
        <div id="list" tabindex="0"><div id="spacer"></div><div id="rows"></div></div>
        <div class="hsplitter"></div>
        <div id="details" class="empty collapsed"></div>
      </div>
      <div id="changes-view" class="view" hidden>
        <div class="cleft">
          <div class="clists">
            <div class="clist" id="unstaged" tabindex="0">
              <div class="chead"><span class="title">Unstaged</span><span class="count"></span><span class="grow"></span>
                <button data-bulk="stage" disabled>${t('stage')} ↓</button></div>
              <ul></ul>
            </div>
            <div class="clist" id="staged" tabindex="0">
              <div class="chead"><span class="title">Staged</span><span class="count"></span><span class="grow"></span>
                <button data-bulk="unstage" disabled>↑ ${t('unstage')}</button></div>
              <ul></ul>
            </div>
          </div>
        </div>
        <div class="vsplitter"></div>
        <div class="cright">
          <div id="diff" class="empty">${t('selectFile')}</div>
          <div class="commit-box">
            <div class="srow">
              <input id="c-subject" type="text" placeholder="${t('commitSubject')}" maxlength="200">
              <button id="c-recent" title="${t('recentTip')}" aria-label="${t('recentTip')}"><span data-icon="list"></span></button>
            </div>
            <textarea id="c-body" placeholder="${t('commitBody')}" rows="4"></textarea>
            <div class="crow">
              <label><input id="c-amend" type="checkbox"> Amend</label>
              <span class="grow"></span>
              <span id="c-len"></span>
              <button id="c-commit" class="primary">Commit</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <div id="activity-pop" hidden></div>
  <div id="mergedlg" hidden></div>
  <div id="stashdlg" hidden></div>
  <div id="pushdlg" hidden></div>
  <div id="pulldlg" hidden></div>
  <div id="fetchdlg" hidden></div>
  <div id="conflictdlg" hidden></div>
  <div id="menu" hidden></div>
  <div id="error" hidden></div>
  <script type="application/json" id="i18n">${JSON.stringify({ ...strings, _lang: lang }).replace(/</g, '\\u003c')}</script>
${scriptTags(MAIN_SCRIPTS, o.nonce, o.uri)}
</body>
</html>`;
}
