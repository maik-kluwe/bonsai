import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { TO_HOST_TYPES } from '../protocol';

type Item = { label: string; msg?: { type: string; [k: string]: unknown }; ui?: { name: string; arg: string | string[] } } | { head: string } | null;
type Sel = { path: string; conflict: boolean };
interface Menus {
  stash(c: { index: number; name: string }): Item[];
  ref(c: { kind: string; name: string; hash: string; index?: number; currentBranch?: string; upstream?: string; ahead?: number; behind?: number; gone?: boolean }): Item[];
  commit(c: { hash: string; subject: string; branches: string[]; parents: string[]; head?: string; currentBranch?: string }): Item[];
  detailFile(c: { hash: string; parent?: string; file: { status: string; path: string; oldPath?: string; base?: string; target?: string } }): Item[];
  changes(c: { which: 'staged' | 'unstaged'; selected: Sel[]; currentBranch?: string; theirs?: string; operation?: boolean }): Item[];
  stashDropdown(c: { stashes: { name: string; label: string; index: number }[] }): Item[];
  recentMessages(c: { messages: { subject: string; message: string }[] }): Item[];
}
const { createMenus }: { createMenus(t: (k: string, ...a: unknown[]) => string): Menus } =
  require('../../media/menus.js');

/** Translation stub: the key, with arguments appended so tests can see what was passed. */
const t = (k: string, ...a: unknown[]) => (a.length ? `${k}:${a.join(',')}` : k);
const m = createMenus(t);

const labels = (items: Item[]) => items.map(i => (i === null ? '-' : 'head' in i ? `#${i.head}` : i.label));
const msgs = (items: Item[]) => items.flatMap(i => (i && 'msg' in i && i.msg ? [i.msg] : []));
const file = (p: string, conflict = false): Sel => ({ path: p, conflict });

describe('ref menu', () => {
  test('local branches and tags: checkout by the full name, create branch at its commit, copy name', () => {
    for (const [kind, name] of [['head', 'feature'], ['head', 'feat/x'], ['tag', 'v1.0'], ['tag', 'release/1.0']]) {
      const items = m.ref({ kind, name, hash: 'h1' });
      const local = kind === 'head';
      assert.deepEqual(labels(items), ['checkout', 'createBranchHere', 'createTagHere', '-', 'pushEntry', '-', ...(local ? ['trackingEntry', 'renameEntry'] : []), 'deleteEntry', '-', 'copyName'], name);
      assert.deepEqual(msgs(items), [
        { type: 'checkout', ref: name }, { type: 'createBranchAt', hash: 'h1' }, { type: 'createTagAt', hash: 'h1' },
        ...(local ? [{ type: 'setTracking', name }, { type: 'renameBranch', name }] : [{ type: 'pushTag', name }]),
        { type: local ? 'deleteBranch' : 'deleteTag', name }, { type: 'copy', text: name },
      ], name);
    }
  });

  test('remote branch: checkout targets the local tracking branch, copy keeps the full name', () => {
    const items = m.ref({ kind: 'remote', name: 'origin/feat/fe-13', hash: 'h1' });
    assert.deepEqual(msgs(items)[0], { type: 'checkout', ref: 'feat/fe-13' });
    assert.deepEqual(msgs(items).slice(3), [{ type: 'deleteRemoteBranch', name: 'origin/feat/fe-13' }, { type: 'copy', text: 'origin/feat/fe-13' }]);
  });

  test('branches other than the current one offer "Merge into"; the ref itself is merged', () => {
    const local = m.ref({ kind: 'head', name: 'feature', hash: 'h', currentBranch: 'main' });
    assert.deepEqual(labels(local), ['checkout', 'createBranchHere', 'createTagHere', '-', 'pushEntry', '-', 'mergeInto:main', 'rebaseOnto:main,feature', 'interactiveRebaseOnto:main,feature', '-', 'trackingEntry', 'renameEntry', 'deleteEntry', '-', 'copyName']);
    assert.deepEqual(msgs(local)[3], { type: 'merge', ref: 'feature' });
    assert.deepEqual(msgs(local)[4], { type: 'rebase', ref: 'feature' });
    const remote = m.ref({ kind: 'remote', name: 'origin/feat/x', hash: 'h', currentBranch: 'main' });
    assert.deepEqual(msgs(remote)[3], { type: 'pullInto', ref: 'origin/feat/x' });
    assert.deepEqual(msgs(remote)[4], { type: 'merge', ref: 'origin/feat/x' });
  });

  test('fast-forward only for another branch that is only behind; pull only for the checked-out one', () => {
    const ref = (over: object) => m.ref({ kind: 'head', name: 'dev', hash: 'h', currentBranch: 'main', upstream: 'origin/dev', ahead: 0, behind: 0, ...over });
    const sync = (over: object) => labels(ref(over)).filter(l => /^(fastForward|pull)Entry/.test(l));
    assert.deepEqual(sync({ behind: 2 }), ['fastForwardEntry:origin/dev']);
    assert.deepEqual(msgs(ref({ behind: 2 }))[3], { type: 'fastForward', name: 'dev' });
    assert.deepEqual(sync({}), [], 'nothing to fetch');
    assert.deepEqual(sync({ behind: 2, ahead: 1 }), [], 'diverged');
    assert.deepEqual(sync({ behind: 2, gone: true }), [], 'upstream deleted');
    assert.deepEqual(sync({ behind: 2, upstream: undefined }), [], 'no upstream');
    assert.deepEqual(sync({ name: 'main', behind: 2 }), ['pullEntry:origin/dev']);
    assert.deepEqual(sync({ name: 'main', gone: true }), []);
  });

  test('push opens the dialog for that branch, whichever is checked out', () => {
    const item = m.ref({ kind: 'head', name: 'dev', hash: 'h', currentBranch: 'main' }).find(i => i && 'ui' in i);
    assert.deepEqual(item && 'ui' in item ? item.ui : undefined, { name: 'openPushDlg', arg: 'dev' });
  });

  test('the checked-out branch cannot be deleted, but renamed', () => {
    const l = labels(m.ref({ kind: 'head', name: 'main', hash: 'h', currentBranch: 'main' }));
    assert.ok(!l.includes('deleteEntry'));
    assert.ok(l.includes('renameEntry'));
  });

  test('no merge entry for the current branch, tags, or when no branch is checked out', () => {
    for (const c of [{ kind: 'head', name: 'main', currentBranch: 'main' }, { kind: 'tag', name: 'v1', currentBranch: 'main' }, { kind: 'head', name: 'dev', currentBranch: undefined }]) {
      assert.ok(!labels(m.ref({ ...c, hash: 'h' })).some(l => l.startsWith('mergeInto')), JSON.stringify(c));
    }
  });

  test('stash: the stash menu, with the index', () => {
    const items = m.ref({ kind: 'stash', name: 'On main: x', hash: 'h', index: 2 });
    assert.deepEqual(labels(items), ['apply', 'rename', '-', 'deleteEllipsis']);
    assert.deepEqual(msgs(items).map(x => [x.action, x.index]), [['apply', 2], ['rename', 2], ['drop', 2]]);
  });
});

describe('commit menu', () => {
  const ctx = (over: Partial<Parameters<Menus['commit']>[0]> = {}) =>
    ({ hash: 'abc', subject: 'subj', branches: [] as string[], parents: ['p'], head: 'zzz', currentBranch: 'main', ...over });

  test('lists a checkout entry per branch first, then detached checkout, branch, operations, copy', () => {
    const items = m.commit(ctx({ branches: ['main', 'dev'] }));
    assert.deepEqual(labels(items), [
      'checkoutRef:main', 'checkoutRef:dev', 'checkoutDetached', 'createBranchHere', 'createTagHere',
      '-', 'mergeBranchInto:dev,main', 'rebaseEntry:main', 'interactiveRebaseEntry', 'cherryPickEntry', 'revertEntry', 'resetEntry:main', '-', 'savePatchEntry', 'compareEntry', '-', 'copyHash', 'copyMessage', 'copyCommitInfo',
    ]);
    assert.deepEqual(msgs(items).map(x => x.ref ?? x.hash ?? x.text), ['main', 'dev', 'abc', 'abc', 'abc', 'dev', 'abc', 'abc', 'abc', 'abc', 'abc', 'abc', 'abc', 'abc', 'subj', 'abc']);
  });

  test('a branch at the commit is merged by name, the current branch is skipped; several branches give several entries', () => {
    const l = labels(m.commit(ctx({ branches: ['main', 'dev', 'topic'] })));
    assert.deepEqual(l.filter(x => x.startsWith('merge')), ['mergeBranchInto:dev,main', 'mergeBranchInto:topic,main']);
    assert.ok(!l.includes('mergeInto:main'), 'hash merge offered although branches exist');
  });

  test('without a branch at the commit, merge, cherry-pick and revert send the commit hash', () => {
    const items = m.commit(ctx());
    assert.deepEqual(msgs(items).filter(x => ['merge', 'cherryPick', 'revert'].includes(x.type)), [
      { type: 'merge', ref: 'abc' }, { type: 'cherryPick', hash: 'abc' }, { type: 'revert', hash: 'abc' },
    ]);
  });

  test('which operations a commit offers, by position, parents and branch', () => {
    const all = { merge: true, cherry: true, revert: true, rebase: true, reset: true, interactive: true };
    const noReplay = { ...all, cherry: false, revert: false, interactive: false };
    const cases: [string, Partial<Parameters<Menus['commit']>[0]>, typeof all][] = [
      ['any other commit', {}, all],
      ['HEAD itself: revert, and an interactive rebase to reword it', { head: 'abc' }, { ...all, merge: false, cherry: false, rebase: false, reset: false }],
      ['merge commit', { parents: ['a', 'b'] }, noReplay],
      ['root commit', { parents: [] }, noReplay],
      ['detached HEAD: no branch to merge into or move', { currentBranch: undefined }, { ...all, merge: false, rebase: false, reset: false, interactive: false }],
    ];
    for (const [name, over, want] of cases) {
      const items = m.commit(ctx(over));
      const l = labels(items), sent = msgs(items);
      const entry = (prefix: string, on: boolean) => assert.deepEqual(l.filter(x => x.startsWith(prefix)), on ? [`${prefix}:main`] : [], `${name}: ${prefix}`);
      const message = (type: string, on: boolean, m: object) => assert.deepEqual(sent.filter(x => x.type === type), on ? [{ type, ...m }] : [], `${name}: ${type}`);
      entry('mergeInto', want.merge);
      assert.equal(l.includes('cherryPickEntry'), want.cherry, `${name}: cherry-pick`);
      assert.equal(l.includes('revertEntry'), want.revert, `${name}: revert`);
      entry('rebaseEntry', want.rebase);
      message('rebase', want.rebase, { ref: 'abc' });
      entry('resetEntry', want.reset);
      message('reset', want.reset, { hash: 'abc' });
      message('interactiveRebase', want.interactive, { hash: 'abc' });
    }
  });

  test('without any operation there is no stray separator', () => {
    const items = m.commit(ctx({ parents: [], currentBranch: undefined }));
    assert.deepEqual(labels(items), ['checkoutDetached', 'createBranchHere', 'createTagHere', '-', 'savePatchEntry', 'compareEntry', '-', 'copyHash', 'copyMessage', 'copyCommitInfo']);
  });

  test('a merge commit cannot be saved as a patch', () => {
    assert.ok(!labels(m.commit(ctx({ parents: ['a', 'b'] }))).includes('savePatchEntry'));
  });
});

describe('detail file menu', () => {
  test('passes the FileChange through, including base/target of stash files', () => {
    const items = m.detailFile({ hash: 'h', parent: 'p', file: { status: 'A', path: 'u.txt', base: 'b', target: 't' } });
    assert.deepEqual(msgs(items)[0], { type: 'openDiff', hash: 'h', parent: 'p', status: 'A', path: 'u.txt', base: 'b', target: 't' });
    assert.deepEqual(msgs(items)[1], { type: 'copy', text: 'u.txt' });
  });
});

describe('changes menu', () => {
  test('staged single file: unstage plus file actions', () => {
    const items = m.changes({ which: 'staged', selected: [file('a.txt')] });
    assert.deepEqual(labels(items), ['unstage', 'stashOneFile', '-', 'openInEditor', 'openVsDiff', 'copyPath']);
    assert.deepEqual(msgs(items)[2], { type: 'openChange', path: 'a.txt', staged: true });
  });

  test('stashing opens the dialog with the marked files, in both lists, but not while a merge or the like is running', () => {
    const dialog = (items: Item[]) => items.find(i => i && 'ui' in i && i.ui?.name === 'openStashDlg');
    for (const which of ['staged', 'unstaged'] as const) {
      const item = dialog(m.changes({ which, selected: [file('a'), file('b')] }));
      assert.ok(item && 'label' in item, which);
      assert.deepEqual(item.ui?.arg, ['a', 'b'], which);
      assert.equal(dialog(m.changes({ which, selected: [file('a')], operation: true })), undefined, which);
    }
  });

  test('unstaged single file: stage, discard, then file actions', () => {
    const items = m.changes({ which: 'unstaged', selected: [file('a.txt')] });
    assert.deepEqual(labels(items), ['stage', 'discardChanges', 'stashOneFile', '-', 'openInEditor', 'openVsDiff', 'copyPath']);
    assert.deepEqual(msgs(items).slice(0, 2), [{ type: 'stage', paths: ['a.txt'] }, { type: 'discard', paths: ['a.txt'] }]);
    assert.equal(msgs(items)[3].staged, false);
  });

  test('several files: counts in the labels, no single-file actions', () => {
    const items = m.changes({ which: 'unstaged', selected: [file('a'), file('b'), file('c')] });
    assert.deepEqual(labels(items), ['stage (3)', 'discardChanges (3)', 'stashFiles:3']);
    assert.deepEqual(msgs(items)[0], { type: 'stage', paths: ['a', 'b', 'c'] });
    assert.deepEqual(labels(m.changes({ which: 'staged', selected: [file('a'), file('b')] })), ['unstage (2)', 'stashFiles:2']);
  });

  test('single conflict: merge dialog (webview action), merge editor, resolve with each side', () => {
    const items = m.changes({ which: 'unstaged', selected: [file('k.txt', true)], currentBranch: 'main', theirs: 'feat' });
    assert.deepEqual(labels(items).slice(0, 5), ['mergeBtn', 'mergeEditor', 'resolveUsing:main', 'resolveUsing:feat', '-']);
    assert.deepEqual((items[0] as { ui: unknown }).ui, { name: 'openMergeDlg', arg: 'k.txt' });
    assert.deepEqual(msgs(items).slice(0, 3), [
      { type: 'mergeEditor', path: 'k.txt' },
      { type: 'resolveUsing', side: 'ours', paths: ['k.txt'] },
      { type: 'resolveUsing', side: 'theirs', paths: ['k.txt'] },
    ]);
  });

  test('other conflict selections: unknown branch, several files, mixed, or in the staged list', () => {
    const bare = labels(m.changes({ which: 'unstaged', selected: [file('k', true)] }));
    assert.equal(bare[2], 'resolveUsing:HEAD', 'no known current branch falls back to HEAD');
    assert.equal(bare[3], 'resolveUsing:', 'no known current branch');
    const several = labels(m.changes({ which: 'unstaged', selected: [file('a', true), file('b', true)], currentBranch: 'main', theirs: 'feat' }));
    assert.deepEqual(several.slice(0, 3), ['resolveUsing:main (2)', 'resolveUsing:feat (2)', '-'], 'several: only the side picks, with counts');
    assert.ok(!several.includes('mergeBtn'), 'several: no merge dialog');
    const mixed = labels(m.changes({ which: 'unstaged', selected: [file('a', true), file('b')] }));
    assert.deepEqual(mixed, ['stage (2)', 'discardChanges (2)', 'stashFiles:2'], 'mixed: no resolve entries');
    assert.ok(!labels(m.changes({ which: 'staged', selected: [file('a', true)] })).some(l => l.startsWith('resolve')), 'staged list: no resolve entries');
  });
});

describe('stash dropdown', () => {
  const st = (index: number, name: string, label = name.replace(/^On main: /, '')) => ({ index, name, label });

  test('sorted by index, newest first, limited to ten', () => {
    const stashes = Array.from({ length: 12 }, (_, i) => st(11 - i, `On main: s${11 - i}`));
    const items = m.stashDropdown({ stashes });
    assert.equal(msgs(items).filter(x => x.type === 'stashAction').length, 10);
    assert.deepEqual(msgs(items).slice(0, 3).map(x => x.index), [0, 1, 2]);
  });

  test('uses the short label, but keeps automatic WIP names complete', () => {
    const items = m.stashDropdown({ stashes: [st(0, 'On main: mine'), st(1, 'WIP on main: abc subject', 'subject')] });
    assert.deepEqual(labels(items).slice(1, 3), ['mine', 'WIP on main: abc subject']);
  });

  test('empty: heading "no stashes"; the snapshot entry is always last', () => {
    const items = m.stashDropdown({ stashes: [] });
    assert.deepEqual(labels(items), ['#recentStashes', '#noStashes', '-', 'saveSnapshot']);
    assert.deepEqual(msgs(items), [{ type: 'action', action: 'snapshot' }]);
  });
});

describe('recent messages', () => {
  test('one entry per message, labelled with the subject, carrying the full message; none: a single inert entry', () => {
    const items = m.recentMessages({ messages: [{ subject: 's1', message: 's1\n\nbody' }] });
    assert.deepEqual(items, [{ label: 's1', ui: { name: 'useMessage', arg: 's1\n\nbody' } }]);
    assert.deepEqual(m.recentMessages({ messages: [] }), [{ label: 'noRecent' }]);
  });
});

describe('contract with src/protocol.ts and main.js', () => {
  test('every host message any menu produces is a ToHost type', () => {
    const sel = (...c: boolean[]) => c.map((x, i) => file(`f${i}`, x));
    const all: Item[][] = [
      m.stash({ index: 0, name: 'n' }),
      ...['head', 'remote', 'tag', 'stash'].map(kind => m.ref({ kind, name: 'origin/x', hash: 'h', index: 0, currentBranch: 'main' })),
      m.commit({ hash: 'h', subject: 's', branches: ['a'], parents: ['p'], head: 'other', currentBranch: 'main' }),
      m.detailFile({ hash: 'h', file: { status: 'M', path: 'p' } }),
      ...(['staged', 'unstaged'] as const).flatMap(which => [sel(false), sel(true), sel(false, true), sel(true, true)].map(selected => m.changes({ which, selected }))),
      m.stashDropdown({ stashes: [{ index: 0, name: 'n', label: 'l' }] }),
    ];
    const types = new Set(all.flatMap(msgs).map(x => x.type));
    assert.ok(types.size >= 8, `only ${types.size} message types exercised`);
    for (const type of types) assert.ok(TO_HOST_TYPES.includes(type), `${type} is not in ToHost`);
  });

  test('every webview action a menu produces is implemented in main.js', () => {
    const js = readFileSync(path.join(__dirname, '../../media/main.js'), 'utf8');
    const block = js.slice(js.indexOf('const uiActions'), js.indexOf('function showMenu'));
    for (const name of ['openMergeDlg', 'useMessage']) assert.ok(block.includes(`${name}:`), `uiActions.${name} missing`);
  });
});

describe('dropBranch', () => {
  const drop = (source: [string, string], target: [string, string], currentBranch: string | null = 'main') =>
    (m as unknown as { dropBranch(c: unknown): { label: string; msg?: unknown }[] }).dropBranch({
      source: { kind: source[0], name: source[1] }, target: { kind: target[0], name: target[1] }, currentBranch,
    });

  test('another branch dropped on the current one offers merge and rebase, in either direction, remote branches too', () => {
    const cases: [ReturnType<typeof drop>, string][] = [
      [drop(['head', 'dev'], ['head', 'main']), 'dev'],
      [drop(['head', 'main'], ['head', 'dev']), 'dev'],
      [drop(['remote', 'origin/dev'], ['head', 'main']), 'origin/dev'],
    ];
    for (const [items, ref] of cases) {
      assert.deepEqual(items.map(i => i.label), [`mergeBranchInto:${ref},main`, `rebaseOnto:main,${ref}`], ref);
      assert.deepEqual(items.map(i => i.msg), [{ type: 'merge', ref }, { type: 'rebase', ref }], ref);
    }
  });

  test('nothing for two other branches, the same branch, tags, stashes, a remote named like the current branch, or a detached HEAD', () => {
    assert.deepEqual(drop(['head', 'dev'], ['head', 'topic']), []);
    assert.deepEqual(drop(['head', 'main'], ['head', 'main']), []);
    assert.deepEqual(drop(['tag', 'v1'], ['head', 'main']), []);
    assert.deepEqual(drop(['head', 'main'], ['stash', 'x']), []);
    assert.deepEqual(drop(['remote', 'main'], ['head', 'dev']), [], 'a remote is never the current branch');
    assert.deepEqual(drop(['head', 'dev'], ['head', 'main'], null), []);
  });
});

describe('drag and drop wiring', () => {
  const js = require('fs').readFileSync(require('path').join(__dirname, '../../media/main.js'), 'utf8') as string;

  test('only branches are draggable: sidebar entries and graph badges', () => {
    assert.match(js, /kind === 'head' \|\| kind === 'remote' \? 'draggable="true"'/);
    assert.match(js, /data-kind="\$\{r\.kind\}" data-name="\$\{esc\(r\.name\)\}" \$\{draggable\(r\.kind\)\}/);
    assert.match(js, /title="\$\{esc\(tip\)\}" \$\{draggable\(r\.kind\)\}/);
  });

  test('a drop is accepted only where the menu has items, and opens that menu', () => {
    assert.match(js, /if \(!hit\?\.items\.length \|\| !e\.dataTransfer\) return;\s+e\.preventDefault\(\);/);
    assert.match(js, /showMenu\(e, hit\.items\)/);
  });
});
