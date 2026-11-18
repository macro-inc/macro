import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { staticFileIdEndpoint } from '@core/constant/servers';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  createInputCommitObservation,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { Gif } from '../../plugins/gif';
import {
  dispatchApplicationCommand,
  dispatchApplicationCommandSettledIfSessionEdit,
} from '../../plugins/group-b/command';
import { createNativeGifContext } from './native-gif';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

/** Everything a test created, torn down even when its assertions fail. */
const cleanups: Array<() => unknown> = [];
/** Run every cleanup independently (reverse order); rethrow the first failure after all ran. */
async function drainCleanups(list: Array<() => unknown>) {
  let first: { error: unknown } | undefined;
  for (const cleanup of list.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      first ??= { error };
    }
  }
  if (first) throw first.error;
}
afterEach(async () => {
  try {
    await drainCleanups(cleanups);
  } finally {
    vi.restoreAllMocks();
  }
});
function owned<Element extends HTMLElement>(element: Element) {
  document.body.append(element);
  cleanups.push(() => element.remove());
  return element;
}

const GIF: Gif = {
  id: 'klipy-1',
  title: 'waving cat',
  url: 'https://example.test/cat.gif',
  previewUrl: 'https://example.test/cat-preview.gif',
  width: 480,
  height: 270,
};
const FILE_ID = '00000000-0000-4000-8000-000000000041';
const TWO_PARAGRAPHS = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: ['first', 'second'].map((text) => ({
      type: 'paragraph',
      version: 1,
      children: [{ type: 'text', version: 1, text }],
    })),
  },
});
const REPLACED = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'replaced' }],
      },
    ],
  },
});

function mount() {
  const root = owned(document.createElement('div'));
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    // The inserted image needs a real decorator view; its component is inert.
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      { image: () => null }
    ),
    {
      namespace: 'native-gif',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError(error) {
        errors.push(error);
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'native-gif'
        ),
    }
  );
  cleanups.push(() => runtime.close());
  runtime.port.setState(TWO_PARAGRAPHS);
  const texts = () =>
    [...runtime.view.mirror.values()].filter((node) => node.kind === 'text');
  const caret = (index: number, offset: number) => {
    const text = texts()[index];
    if (!text) throw new Error('Missing actual text');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset, type: 'text' },
      focus: { key: text.key, offset, type: 'text' },
    });
  };
  runtime.view.focus();
  return { ...runtime, root, errors, texts, caret };
}

function bound(runtime: ReturnType<typeof mount>) {
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  cleanups.push(() => gif.dispose());
  return gif;
}

/** The picker's search field holds focus, so the browser selection leaves the root. */
function focusSearch() {
  const search = owned(document.createElement('input'));
  search.focus();
  window.getSelection()?.removeAllRanges();
}

/** Raw top-level children of the actual serialized state. */
function children(
  runtime: ReturnType<typeof mount>
): Array<{ type: string; [field: string]: unknown }> {
  return JSON.parse(runtime.view.query.serializedState()).root.children;
}
const imageIndex = (runtime: ReturnType<typeof mount>) =>
  children(runtime).findIndex((node) => node.type === 'image');

function prepared(
  gif: ReturnType<typeof createNativeGifContext>,
  canEdit = () => true
) {
  const insertion = gif.host.prepareInsertion(
    gif.host.captureTarget(),
    canEdit
  );
  if (!insertion) throw new Error('Expected an insertion');
  return insertion;
}

/**
 * Enqueue the commit inside one executor turn. `before` runs before the commit
 * is enqueued, `after` runs once it is queued, and `output` is the turn's own
 * session output; the queued input is admitted only after the turn returns.
 */
function queued(
  runtime: ReturnType<typeof mount>,
  start: () => Promise<boolean> | boolean,
  turn: {
    before?: () => void;
    after?: () => void;
    output?: () => ReturnType<typeof runtime.executor.session.tick>;
  }
) {
  let pending: Promise<boolean> | boolean | undefined;
  runtime.executor.run(() => {
    turn.before?.();
    pending = start();
    turn.after?.();
    return turn.output
      ? turn.output()
      : runtime.executor.session.tick(runtime.executor.now(), Date.now());
  });
  return Promise.resolve(pending);
}
/** Read or comment access, applied as the session's own authorization output. */
const authorization = (runtime: ReturnType<typeof mount>, comment: boolean) =>
  runtime.executor.session.authorization(
    true,
    false,
    comment,
    runtime.executor.now(),
    Date.now()
  );

test('the GIF request is refused before projection and before the picker registers', () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  cleanups.push(() => gif.dispose());
  const onOpen = vi.fn();
  expect(gif.requestOpen()).toBe(false);
  gif.bindView(runtime.view);
  expect(gif.requestOpen()).toBe(false);
  createRoot((dispose) => {
    cleanups.push(dispose);
    gif.host.registerPicker(() => false, onOpen);
    expect(gif.requestOpen()).toBe(false);
  });
  expect(onOpen).not.toHaveBeenCalled();
});

test('an editable bound view opens the registered picker; disposal refuses it', () => {
  const runtime = mount();
  const gif = bound(runtime);
  const onOpen = vi.fn();
  createRoot((dispose) => {
    cleanups.push(dispose);
    gif.host.registerPicker(() => true, onOpen);
    expect(gif.requestOpen()).toBe(true);
    gif.dispose();
    expect(gif.requestOpen()).toBe(false);
  });
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('commit inserts the Source GIF image at the caret captured on open', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const insertion = prepared(gif);
  // End of "second": a live-caret insert would land after the second paragraph.
  runtime.caret(1, 6);
  const moved = runtime.view.selection().selection;
  expect(moved.kind === 'range' && moved.anchor.key).toBe(
    runtime.texts()[1]?.key
  );
  focusSearch();
  const onInserted = vi.fn();
  await expect(
    gif.host.commit(insertion, GIF, FILE_ID, onInserted)
  ).resolves.toBe(true);
  expect(onInserted).toHaveBeenCalledTimes(1);
  expect(imageIndex(runtime)).toBe(1);
  expect(children(runtime)[1]).toMatchObject({
    type: 'image',
    srcType: 'sfs',
    id: FILE_ID,
    url: staticFileIdEndpoint(FILE_ID),
    alt: GIF.title,
    width: 480,
    height: 270,
    constrainedWidth: 400,
    constrainedHeight: 225,
  });
  expect(runtime.errors).toEqual([]);
});

test('targetless with no live selection selects the end, as Source does', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.port.selectionFromView({ kind: 'none' });
  expect(runtime.view.selection().selection.kind).toBe('none');
  const insertion = prepared(gif);
  expect(insertion.target).toBeUndefined();
  focusSearch();
  await expect(gif.host.commit(insertion, GIF, FILE_ID, vi.fn())).resolves.toBe(
    true
  );
  // After the last block; Source's GIF insert then selects a following paragraph.
  expect(imageIndex(runtime)).toBe(2);
  expect(
    children(runtime)
      .slice(0, 2)
      .map((node) => node.type)
  ).toEqual(['paragraph', 'paragraph']);
});

test('targetless with a live model selection keeps that selection, as Source does', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.port.selectionFromView({ kind: 'none' });
  const insertion = prepared(gif);
  runtime.caret(0, 5);
  focusSearch();
  await expect(gif.host.commit(insertion, GIF, FILE_ID, vi.fn())).resolves.toBe(
    true
  );
  expect(imageIndex(runtime)).toBe(1);
});

test('a captured caret whose text was removed does not receive the image', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const insertion = prepared(gif);
  runtime.port.setState(REPLACED);
  const onInserted = vi.fn();
  await expect(
    gif.host.commit(insertion, GIF, FILE_ID, onInserted)
  ).resolves.toBe(false);
  expect(onInserted).not.toHaveBeenCalled();
  expect(imageIndex(runtime)).toBe(-1);
});

for (const [label, comment, access] of [
  ['view-only', false, Access.Read],
  ['comment-only', true, Access.CommentOnly],
] as const) {
  test(`${label} access is not editable and prepares no insertion`, () => {
    const runtime = mount();
    const gif = bound(runtime);
    runtime.caret(0, 5);
    runtime.executor.run(() => authorization(runtime, comment));
    expect(runtime.executor.session.effectiveAccess()).toBe(access);
    expect(gif.host.isEditable()).toBe(false);
    expect(
      gif.host.prepareInsertion(gif.host.captureTarget(), () => true)
    ).toBeUndefined();
  });

  test(`${label} access arriving before admission inserts nothing`, async () => {
    const runtime = mount();
    const gif = bound(runtime);
    runtime.caret(0, 5);
    const insertion = prepared(gif);
    const pending = queued(
      runtime,
      () => gif.host.commit(insertion, GIF, FILE_ID, vi.fn()),
      { output: () => authorization(runtime, comment) }
    );
    await expect(pending).resolves.toBe(false);
    expect(runtime.executor.session.effectiveAccess()).toBe(access);
    expect(imageIndex(runtime)).toBe(-1);
  });
}

test('editing turned off by the picker owner before admission inserts nothing', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  let canEdit = true;
  const insertion = prepared(gif, () => canEdit);
  const pending = queued(
    runtime,
    () => gif.host.commit(insertion, GIF, FILE_ID, vi.fn()),
    {
      after: () => {
        canEdit = false;
      },
    }
  );
  await expect(pending).resolves.toBe(false);
  expect(imageIndex(runtime)).toBe(-1);
});

test('a context retired while the insert is queued inserts nothing', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const insertion = prepared(gif);
  const pending = queued(
    runtime,
    () => gif.host.commit(insertion, GIF, FILE_ID, vi.fn()),
    { after: () => gif.dispose() }
  );
  await expect(pending).resolves.toBe(false);
  expect(imageIndex(runtime)).toBe(-1);
});

test('a context rebound to another view while queued never retargets', async () => {
  const runtime = mount();
  const other = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const insertion = prepared(gif);
  const pending = queued(
    runtime,
    () => gif.host.commit(insertion, GIF, FILE_ID, vi.fn()),
    { after: () => gif.bindView(other.view) }
  );
  await expect(pending).resolves.toBe(false);
  expect(imageIndex(runtime)).toBe(-1);
  expect(imageIndex(other)).toBe(-1);
  expect(gif.host.isCurrent(insertion)).toBe(false);
});

test('a captured caret detached while the insert is queued inserts nothing', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const insertion = prepared(gif);
  const captured = runtime.texts()[0]?.key;
  let presentAtEnqueue: boolean | undefined;
  // The replacement is queued ahead of the insert, so the early check passes
  // and only the admission-time check can see the detached caret.
  const pending = queued(
    runtime,
    () => {
      presentAtEnqueue =
        captured !== undefined && runtime.view.node(captured) !== null;
      return gif.host.commit(insertion, GIF, FILE_ID, vi.fn());
    },
    { before: () => runtime.port.setState(REPLACED) }
  );
  await expect(pending).resolves.toBe(false);
  expect(presentAtEnqueue).toBe(true);
  expect(captured !== undefined && runtime.view.node(captured)).toBeNull();
  expect(imageIndex(runtime)).toBe(-1);
});

test('an earlier commit observer that throws cannot make a referenced upload look unused', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  const failure = new Error('earlier commit observer failed');
  const stop = runtime.view.onCommit((commit) => {
    if ([...commit.mutations.values()].some((m) => m.after?.type === 'image'))
      throw failure;
  });
  cleanups.push(stop);
  const reported = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  cleanups.push(() => reported.mockRestore());
  runtime.caret(0, 5);
  const onInserted = vi.fn();
  const result = await Promise.resolve(
    gif.host.commit(prepared(gif), GIF, FILE_ID, onInserted)
  ).catch((error: unknown) => ({ rejected: error }));
  // The document references the file, so the picker must keep the upload.
  expect(result).toBe(true);
  expect(onInserted).toHaveBeenCalledTimes(1);
  // The observer's own error still surfaces, exactly once.
  expect(reported).toHaveBeenCalledTimes(1);
  expect(reported).toHaveBeenCalledWith(failure, {
    source: 'native-gif-insert-after-publish',
  });
  expect(children(runtime)[imageIndex(runtime)]).toMatchObject({
    id: FILE_ID,
  });
  stop();
  // The next healthy input still inserts its own file.
  const next = '00000000-0000-4000-8000-000000000042';
  runtime.caret(0, 5);
  await expect(
    gif.host.commit(prepared(gif), GIF, next, vi.fn())
  ).resolves.toBe(true);
  expect(
    children(runtime)
      .filter((node) => node.type === 'image')
      .map((node) => node.id)
  ).toContain(next);
});

test('a failing onInserted callback keeps the upload and reports the fault', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  const reported = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  runtime.caret(0, 5);
  await expect(
    gif.host.commit(prepared(gif), GIF, FILE_ID, () => {
      throw new Error('picker callback failed');
    })
  ).resolves.toBe(true);
  expect(reported).toHaveBeenCalledTimes(1);
  expect(imageIndex(runtime)).toBe(1);
});

test('document changes, not caret moves, cancel an in-flight insertion', () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const onDirty = vi.fn();
  const stop = gif.host.subscribeChanges(prepared(gif), onDirty);
  cleanups.push(stop);
  runtime.caret(1, 2);
  expect(onDirty).not.toHaveBeenCalled();
  runtime.port.setState(REPLACED);
  expect(onDirty).toHaveBeenCalled();
});

test('focus leaving the root for the panel does not propagate; cleanup cancels the upload', () => {
  const runtime = mount();
  const gif = bound(runtime);
  const panel = owned(document.createElement('div'));
  const input = document.createElement('input');
  panel.append(input);
  const outer = vi.fn();
  document.body.addEventListener('focusout', outer);
  cleanups.push(() => document.body.removeEventListener('focusout', outer));
  const cancel = vi.fn();
  createRoot((dispose) => {
    gif.host.registerPanel(panel, cancel);
    runtime.root.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: input })
    );
    expect(outer).not.toHaveBeenCalled();
    runtime.root.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null })
    );
    expect(outer).toHaveBeenCalledTimes(1);
    dispose();
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  runtime.root.dispatchEvent(
    new FocusEvent('focusout', { bubbles: true, relatedTarget: input })
  );
  expect(outer).toHaveBeenCalledTimes(2);
});

const cell = (text: string) => ({
  type: 'tablecell',
  version: 1,
  headerState: 0,
  colSpan: 1,
  rowSpan: 1,
  children: [
    {
      type: 'paragraph',
      version: 1,
      children: [{ type: 'text', version: 1, text }],
    },
  ],
});
const TABLE = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'table',
        version: 1,
        children: [
          { type: 'tablerow', version: 1, children: [cell('a1'), cell('b1')] },
          { type: 'tablerow', version: 1, children: [cell('a2'), cell('b2')] },
        ],
      },
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'after' }],
      },
    ],
  },
});
function tableSelection(runtime: ReturnType<typeof mount>) {
  runtime.port.setState(TABLE);
  const nodes = [...runtime.view.mirror.values()];
  const table = nodes.find((node) => node.type === 'table');
  const cells = nodes.filter((node) => node.type === 'tablecell');
  if (!table || cells.length !== 4) throw new Error('Missing actual table');
  const [anchor, , , focus] = cells;
  if (!anchor || !focus) throw new Error('Missing actual cells');
  runtime.port.selectionFromView({
    kind: 'table',
    table: table.key,
    anchorCell: anchor.key,
    focusCell: focus.key,
  });
  return { table, anchor, focus };
}
const images = (runtime: ReturnType<typeof mount>) =>
  [...runtime.view.mirror.values()].filter((node) => node.type === 'image');

test('healthy table selection: admitted and handled, but attaches no image, as Source', async () => {
  // Source $insertNodesAndSplitList returns for any non-range selection
  // (LexicalMarkdown/utils.ts:1027-1029) while its GIF commit still reports
  // inserted: the known shared no-attach retention (t1tm ruling).
  const runtime = mount();
  const gif = bound(runtime);
  tableSelection(runtime);
  const before = runtime.view.query.serializedState();
  const insertion = prepared(gif);
  expect(insertion.target?.selection.kind).toBe('table');
  expect(gif.host.isCurrent(insertion)).toBe(true);
  const onInserted = vi.fn();
  await expect(
    gif.host.commit(insertion, GIF, FILE_ID, onInserted)
  ).resolves.toBe(true);
  expect(onInserted).toHaveBeenCalledTimes(1);
  expect(images(runtime)).toHaveLength(0);
  expect(runtime.view.query.serializedState()).toBe(before);
});

// Source oracle: plugins/gif/detachedCapture.source.test.ts. Source rechecks
// attachment only for a captured range; a detached node or table capture
// commits true, attaches nothing and reports the upload owned. That orphan
// upload is a known shared Source leak, mirrored here for exact parity.
test('table focus cell deleted while the insert is queued (table and anchor remain): nothing attached, owned, as Source', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  const { table, anchor, focus } = tableSelection(runtime);
  const insertion = prepared(gif);
  const onInserted = vi.fn();
  const pending = queued(
    runtime,
    () => gif.host.commit(insertion, GIF, FILE_ID, onInserted),
    {
      before: () => {
        // Real native inputs queued ahead of the insert: a caret in the focus
        // cell (row deletion follows the live selection), then delete that row.
        const text = [...runtime.view.mirror.values()].find(
          (node) =>
            node.kind === 'text' &&
            node.parent !== null &&
            runtime.view.node(node.parent)?.parent === focus.key
        );
        if (!text) throw new Error('Missing actual focus-cell text');
        runtime.port.selectionFromView({
          kind: 'range',
          anchor: { key: text.key, offset: 0, type: 'text' },
          focus: { key: text.key, offset: 0, type: 'text' },
        });
        dispatchApplicationCommand(runtime.view, 'group-b.table', {
          action: 'delete',
          cell: focus.key,
          axis: 'row',
        });
      },
    }
  );
  await expect(pending).resolves.toBe(true);
  const rest = {
    table: runtime.view.node(table.key) !== null,
    anchor: runtime.view.node(anchor.key) !== null,
    focus: runtime.view.node(focus.key) !== null,
  };
  expect(rest).toEqual({ table: true, anchor: true, focus: false });
  expect(onInserted).toHaveBeenCalledTimes(1);
  expect(images(runtime)).toHaveLength(0);
});

/** Selection kind and keys, named by the fixture, in the Source oracle's shape. */
function describeSelection(
  runtime: ReturnType<typeof mount>,
  names: Map<number, string>
) {
  const name = (key: number) =>
    names.get(key) ?? `unnamed:${runtime.view.node(key)?.type ?? 'missing'}`;
  const { selection } = runtime.view.selection();
  if (selection.kind === 'node')
    return { kind: 'node', keys: selection.keys.map(name) };
  if (selection.kind === 'table')
    return {
      kind: 'table',
      table: name(selection.table),
      anchor: name(selection.anchorCell),
      focus: name(selection.focusCell),
    };
  if (selection.kind === 'range')
    return {
      kind: 'range',
      anchor: [name(selection.anchor.key), selection.anchor.offset],
      focus: [name(selection.focus.key), selection.focus.offset],
    };
  return { kind: selection.kind };
}

/** Commit a detached capture; record the Source oracle's facts natively. */
async function commitDetached(
  runtime: ReturnType<typeof mount>,
  gif: ReturnType<typeof bound>,
  names: Map<number, string>
) {
  const insertion = prepared(gif);
  runtime.port.setState(REPLACED);
  const state = runtime.view.query.serializedState();
  const beforeCommit = describeSelection(runtime, names);
  const commits: Array<{ mutations: number; selectionChanged: boolean }> = [];
  const stop = runtime.view.onCommit((commit) => {
    commits.push({
      mutations: commit.mutations.size,
      selectionChanged: commit.selectionChanged,
    });
  });
  const onInserted = vi.fn();
  const result = await gif.host.commit(insertion, GIF, FILE_ID, onInserted);
  stop();
  return {
    result,
    owned: onInserted.mock.calls.length,
    beforeCommit,
    afterCommit: describeSelection(runtime, names),
    commits,
    stateUnchanged: runtime.view.query.serializedState() === state,
    images: images(runtime).length,
  };
}

test('a table capture detached before commit: Source outcome (oracle detachedCapture.source.test.ts)', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  const { table, anchor, focus } = tableSelection(runtime);
  const names = new Map([
    [table.key, 'table'],
    [anchor.key, 'anchorCell'],
    [focus.key, 'focusCell'],
  ]);
  expect(await commitDetached(runtime, gif, names)).toEqual({
    result: true,
    owned: 1,
    // Named difference (pending PM ruling): the native mirror holds no
    // selection over removed keys, so after the detaching state the live
    // selection is none, where Lexical keeps the stale capture.
    beforeCommit: { kind: 'none' },
    afterCommit: { kind: 'none' },
    // Source runs one empty update (nothing dirty, no tags, no selection
    // change); native sends no input, so no commit is published.
    commits: [],
    stateUnchanged: true,
    images: 0,
  });
});

test('a node capture detached before commit: Source outcome (oracle detachedCapture.source.test.ts)', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  await gif.host.commit(prepared(gif), GIF, 'node-fixture-image', vi.fn());
  const [image] = images(runtime);
  if (!image) throw new Error('Missing actual image');
  runtime.port.selectionFromView({ kind: 'node', keys: [image.key] });
  expect(runtime.view.selection().selection.kind).toBe('node');
  const names = new Map([[image.key, 'image']]);
  expect(await commitDetached(runtime, gif, names)).toEqual({
    result: true,
    owned: 1,
    // Named difference (pending PM ruling): the native mirror holds no
    // selection over removed keys, so after the detaching state the live
    // selection is none, where Lexical keeps the stale capture.
    beforeCommit: { kind: 'none' },
    afterCommit: { kind: 'none' },
    // Source runs one empty update (nothing dirty, no tags, no selection
    // change); native sends no input, so no commit is published.
    commits: [],
    stateUnchanged: true,
    images: 0,
  });
});

for (const [label, cause] of [
  ['undefined', undefined],
  ['null', null],
  ['an opaque object', { opaque: true }],
] as const) {
  test(`onInserted throwing ${label} still resolves true, keeps the file, next input healthy`, async () => {
    const runtime = mount();
    const gif = bound(runtime);
    vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    runtime.caret(0, 5);
    await expect(
      gif.host.commit(prepared(gif), GIF, FILE_ID, () => {
        throw cause;
      })
    ).resolves.toBe(true);
    expect(images(runtime).map((node) => node.props().id)).toEqual([FILE_ID]);
    const next = '00000000-0000-4000-8000-000000000043';
    runtime.caret(0, 5);
    await expect(
      gif.host.commit(prepared(gif), GIF, next, vi.fn())
    ).resolves.toBe(true);
    expect(images(runtime).map((node) => node.props().id)).toContain(next);
  });
}

test('a throwing Telemetry reporter inside the onInserted fault still resolves true', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {
    throw new Error('reporter failed');
  });
  runtime.caret(0, 5);
  await expect(
    gif.host.commit(prepared(gif), GIF, FILE_ID, () => {
      throw new Error('picker callback failed');
    })
  ).resolves.toBe(true);
  expect(images(runtime).map((node) => node.props().id)).toEqual([FILE_ID]);
});

test('cleanup drain runs every step after a failure and rethrows the first', async () => {
  const ran: string[] = [];
  const first = new Error('first cleanup failed');
  const list: Array<() => unknown> = [
    () => ran.push('a'),
    () => {
      ran.push('b');
      throw new Error('second failure');
    },
    () => {
      ran.push('c');
      throw first;
    },
    () => ran.push('d'),
  ];
  await expect(drainCleanups(list)).rejects.toBe(first);
  expect(ran).toEqual(['d', 'c', 'b', 'a']);
  expect(list).toEqual([]);
});

test('another input inserting the SAME file id, queued after ours: both published; the delta cannot attribute per input', async () => {
  const runtime = mount();
  const gif = bound(runtime);
  runtime.caret(0, 5);
  const insertion = prepared(gif);
  const other = createInputCommitObservation();
  let otherSettled: Promise<unknown> | undefined;
  const pending = queued(
    runtime,
    () => gif.host.commit(insertion, GIF, FILE_ID, vi.fn()),
    {
      after: () => {
        otherSettled = dispatchApplicationCommandSettledIfSessionEdit(
          runtime.view,
          'group-b.media',
          () => ({
            action: 'insert',
            kind: 'image',
            media: {
              srcType: 'sfs',
              id: FILE_ID,
              url: staticFileIdEndpoint(FILE_ID),
            },
          }),
          { mainCommit: other }
        );
      },
    }
  );
  await expect(pending).resolves.toBe(true);
  await otherSettled;
  const otherEvidence = other.read();
  // Reported as observed: the other input's own main commit, and two images
  // with this file id. The host's reference delta alone does not prove which
  // input owns which image; ownership here also rests on published && mainHandled.
  expect(otherEvidence.status).toBe('published');
  expect(
    images(runtime).filter((node) => node.props().id === FILE_ID)
  ).toHaveLength(2);
});
