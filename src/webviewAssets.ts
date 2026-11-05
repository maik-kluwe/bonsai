/**
 * Scripts of the main view, in load order: helpers first, main.js last because it uses them.
 * webviewAssets.test.ts checks that this list and media/ agree.
 */
export const MAIN_SCRIPTS = [
  'lanes.js', 'mergeresolve.js', 'selection.js', 'commitbox.js', 'menus.js', 'linesel.js', 'avatar.js', 'activity.js',
  'mergebar.js', 'look.js', 'details.js', 'localdiff.js', 'mergedialog.js', 'stashdialog.js', 'pushdialog.js', 'nav.js', 'icons.js', 'diffhtml.js', 'mergehtml.js', 'main.js',
] as const;

/** Scripts of the rebase dialog (rebasePanel.ts). */
export const REBASE_SCRIPTS = ['rebaseplan.js', 'rebasedlg.js'] as const;

/** `<script>` tags for `names`; `uri` turns a file name into the address the webview loads it from. */
export const scriptTags = (names: readonly string[], nonce: string, uri: (file: string) => string): string =>
  names.map(n => `  <script nonce="${nonce}" src="${uri(n)}"></script>`).join('\n');
