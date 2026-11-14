/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { createInlineMenuTriggerListener } from '@core/component/LexicalMarkdown/shared/registerInlineMenuTrigger';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  type EditorView,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { createSignal } from 'solid-js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';

// Source MarkdownPopup's touch handlers over a real mounted native session.
// Paste: the MODEL selection captured at the tap, a raw-text insert as
// Source's insertRawText (no paste handling: a URL, a multi-line string and a
// leading '#' land literally), gated on the overlay lifetime, the same view
// and generation and Edit access, then the popup hides. Show comment clears
// the MODEL selection before blurring and hides. Table converts exactly the
// list holding the selection. Only the pasteboard and the toast are replaced.

const pasteboard = vi.hoisted(() => ({
  read: vi.fn<() => Promise<string | null>>(),
  failures: [] as string[],
}));
vi.mock('@core/mobile/nativeEditMenu', () => ({
  readNativePasteboardText: pasteboard.read,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: (message: string) => pasteboard.failures.push(message) },
}));

const { createNativeBodyTouchActions } = await import('./native-touch-actions');

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
        '../../../../lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

const owned: (() => Promise<void> | void)[] = [];
beforeEach(() => {
  pasteboard.read.mockReset();
  pasteboard.failures.length = 0;
});
afterEach(async () => {
  const failures: unknown[] = [];
  for (const release of owned.splice(0).reverse())
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  try {
    vi.restoreAllMocks();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
});

const text = (value: string) => ({ type: 'text', version: 1, text: value });
const paragraph = (id: string, value: string) => ({
  type: 'paragraph',
  version: 1,
  $: { id },
  children: [text(value)],
});
const list = (id: string, items: string[]) => ({
  type: 'task-list',
  version: 1,
  listType: 'bullet',
  start: 1,
  tag: 'ul',
  $: { id },
  children: items.map((item, index) => ({
    type: 'listitem',
    version: 1,
    value: index + 1,
    children: [text(item)],
  })),
});

/** A list with table shape (Source $listToGrid): each header item followed
 *  by a nesting wrapper holding that column's cells. */
const gridList = (id: string, columns: [string, string[]][]) => ({
  type: 'task-list',
  version: 1,
  listType: 'bullet',
  start: 1,
  tag: 'ul',
  $: { id },
  children: columns.flatMap(([header, cells], index) => [
    {
      type: 'listitem',
      version: 1,
      value: index + 1,
      children: [text(header)],
    },
    {
      type: 'listitem',
      version: 1,
      value: index + 2,
      children: [list(`${id}-${index}`, cells)],
    },
  ]),
});

function mountSession(children: unknown[]) {
  const root = document.createElement('div');
  document.body.append(root);
  owned.push(() => root.remove());
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'touch-actions',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
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
          'touch-actions'
        ),
    }
  );
  owned.push(async () => {
    if (runtime.view.isMounted) await runtime.close();
  });
  runtime.port.setState(
    JSON.stringify({ root: { type: 'root', version: 1, children } })
  );
  runtime.port.command(CommandCode.ClearHistory);
  return runtime;
}
type Runtime = ReturnType<typeof mountSession>;

/** Set the MODEL selection over part of a text node. */
function select(runtime: Runtime, value: string, from: number, to: number) {
  const node = [...runtime.view.mirror.values()].find(
    (candidate) => candidate.kind === 'text' && candidate.text === value
  );
  if (!node) throw new Error(`Missing text node ${value}`);
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: node.key, offset: from, type: 'text' },
    focus: { key: node.key, offset: to, type: 'text' },
  });
}

/** The stored document's top-level blocks as [type, plain content]. */
function blocks(runtime: Runtime): [string, string][] {
  const state = JSON.parse(runtime.view.query.serializedState());
  const plain = (node: {
    type: string;
    text?: string;
    children?: unknown[];
  }): string =>
    node.type === 'linebreak'
      ? '\n'
      : (node.text ?? '') +
        (node.children ?? [])
          .map((child) =>
            plain(
              child as { type: string; text?: string; children?: unknown[] }
            )
          )
          .join('');
  return state.root.children.map(
    (node: { type: string; children?: unknown[] }) => [node.type, plain(node)]
  );
}

function actions(
  runtime: Runtime,
  overrides: {
    alive?: () => boolean;
    view?: () => EditorView | undefined;
    comment?: { canComment: () => boolean; insert: () => boolean };
    highlighted?: () => readonly string[];
    activate?: (thread: string) => void;
  } = {}
) {
  return createNativeBodyTouchActions({
    documentId: () => 'doc-1',
    view: overrides.view ?? (() => runtime.view),
    canEdit: () => true,
    alive: overrides.alive ?? (() => true),
    comments: {
      highlighted: overrides.highlighted ?? (() => []),
      activate: overrides.activate ?? (() => {}),
    },
    comment: overrides.comment,
    snippetLink: () => undefined,
  });
}

/** A pasteboard read the test resolves. */
function pendingPasteboard() {
  let release!: (value: string) => void;
  pasteboard.read.mockReturnValue(
    new Promise<string>((resolve) => {
      release = resolve;
    })
  );
  return (value: string) => release(value);
}

for (const [label, pasted] of [
  ['a URL', 'https://example.com/a?b=c'],
  ['a multi-line string', 'one\ntwo'],
  ["a leading '#'", '# not a heading'],
] as const) {
  test(`paste inserts ${label} literally at the captured selection and hides`, async () => {
    const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
    select(runtime, 'Alpha beta', 0, 5);
    const release = pendingPasteboard();
    const hide = vi.fn();
    const pasting = actions(runtime).paste(hide);
    release(pasted);
    await pasting;
    expect(blocks(runtime)).toEqual([['paragraph', `${pasted} beta`]]);
    // Raw text: no link, no heading, no extra block.
    expect(runtime.view.query.serializedState()).not.toContain('"type":"link"');
    expect(hide).toHaveBeenCalledTimes(1);
  });
}

test('paste lands at the MODEL selection captured at the tap after the DOM selection collapses', async () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  select(runtime, 'Alpha beta', 6, 10);
  const release = pendingPasteboard();
  const pasting = actions(runtime).paste(() => {});
  // The tap and the read move the DOM selection: collapse it elsewhere.
  document.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
  select(runtime, 'Alpha beta', 0, 0);
  release('gamma');
  await pasting;
  expect(blocks(runtime)).toEqual([['paragraph', 'Alpha gamma']]);
});

test('paste after the overlay lifetime ends, with the view still mounted, inserts nothing', async () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  select(runtime, 'Alpha beta', 0, 5);
  const [alive, setAlive] = createSignal(true);
  const input = vi.spyOn(runtime.port, 'inputIfSessionEdit');
  const release = pendingPasteboard();
  const hide = vi.fn();
  const pasting = actions(runtime, { alive }).paste(hide);
  setAlive(false);
  release('pasted');
  await pasting;
  expect(runtime.view.isMounted).toBe(true);
  expect(input).not.toHaveBeenCalled();
  expect(blocks(runtime)).toEqual([['paragraph', 'Alpha beta']]);
  expect(hide).not.toHaveBeenCalled();
});

test('paste with no lifetime at the tap reads no pasteboard', async () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  select(runtime, 'Alpha beta', 0, 5);
  await actions(runtime, { alive: () => false }).paste(() => {});
  expect(pasteboard.read).not.toHaveBeenCalled();
});

test('paste after the origin rebinds during the pasteboard await inserts nothing', async () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  select(runtime, 'Alpha beta', 0, 5);
  const input = vi.spyOn(runtime.port, 'inputIfSessionEdit');
  const release = pendingPasteboard();
  const pasting = actions(runtime).paste(() => {});
  const generation = runtime.view.mirror.keyGeneration;
  if (generation === null) throw new Error('Missing key generation');
  // Synthetic stand-in for a mirror re-initialize (a reset or resync).
  vi.spyOn(runtime.view.mirror, 'keyGeneration', 'get').mockReturnValue(
    generation + 1
  );
  release('pasted');
  await pasting;
  expect(input).not.toHaveBeenCalled();
});

test('paste after Edit access is lost during the pasteboard await inserts nothing', async () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  select(runtime, 'Alpha beta', 0, 5);
  const input = vi.spyOn(runtime.port, 'inputIfSessionEdit');
  const release = pendingPasteboard();
  const pasting = actions(runtime).paste(() => {});
  runtime.executor.run(() =>
    runtime.executor.session.authorization(
      true,
      false,
      false,
      runtime.executor.now(),
      Date.now()
    )
  );
  release('pasted');
  await pasting;
  expect(input).not.toHaveBeenCalled();
  expect(blocks(runtime)).toEqual([['paragraph', 'Alpha beta']]);
});

test('an empty pasteboard inserts nothing and does not hide', async () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  select(runtime, 'Alpha beta', 0, 5);
  pasteboard.read.mockResolvedValue(null);
  const hide = vi.fn();
  await actions(runtime).paste(hide);
  expect(blocks(runtime)).toEqual([['paragraph', 'Alpha beta']]);
  expect(hide).not.toHaveBeenCalled();
});

test('Show comment clears the MODEL selection, then blurs, opens the thread and hides', () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  const order: string[] = [];
  vi.spyOn(runtime.view.port, 'selectionFromView').mockImplementation(
    (selection) => {
      order.push(`model-selection:${selection.kind}`);
    }
  );
  vi.spyOn(runtime.view.root, 'blur').mockImplementation(() => {
    order.push('blur');
  });
  actions(runtime, {
    highlighted: () => ['thread-1', 'thread-2'],
    activate: (thread) => order.push(`activate:${thread}`),
  }).openComment.open(() => order.push('hide'));
  expect(order).toEqual([
    'model-selection:none',
    'blur',
    'activate:thread-1',
    'hide',
  ]);
});

test('Comment shows Source toast when no draft is created and hides on success', () => {
  const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
  const hide = vi.fn();
  actions(runtime, {
    comment: { canComment: () => true, insert: () => false },
  }).insertComment(hide);
  expect(pasteboard.failures).toEqual(['Please highlight text to comment.']);
  expect(hide).not.toHaveBeenCalled();
  actions(runtime, {
    comment: { canComment: () => true, insert: () => true },
  }).insertComment(hide);
  expect(hide).toHaveBeenCalledTimes(1);
});

test('Table converts exactly the list holding the selection', () => {
  const runtime = mountSession([
    gridList('listOne', [
      ['first a', ['a1']],
      ['first b', ['b1']],
    ]),
    paragraph('between', 'Between'),
    gridList('listTwo', [
      ['second a', ['a2']],
      ['second b', ['b2']],
    ]),
  ]);
  select(runtime, 'second a', 0, 3);
  const touch = actions(runtime);
  expect(touch.table.available()).toBe(true);
  expect(touch.table.convert()).toBe(true);
  // The first list is untouched; the selected one is now the table (a table
  // ending the document gets its trailing paragraph, as in Source).
  expect(
    blocks(runtime)
      .map(([type]) => type)
      .slice(0, 3)
  ).toEqual(['task-list', 'paragraph', 'table']);
  expect(blocks(runtime)[0][1]).toContain('first a');
});

test('Table is hidden and converts nothing outside any list', () => {
  const runtime = mountSession([
    gridList('listOne', [
      ['first a', ['a1']],
      ['first b', ['b1']],
    ]),
    paragraph('between', 'Between'),
  ]);
  select(runtime, 'Between', 0, 3);
  const touch = actions(runtime);
  expect(touch.table.available()).toBe(false);
  expect(touch.table.convert()).toBe(false);
  expect(blocks(runtime).map(([type]) => type)).toEqual([
    'task-list',
    'paragraph',
  ]);
});

test('Table is hidden after the overlay lifetime ends', () => {
  const runtime = mountSession([
    gridList('listOne', [
      ['first a', ['a1']],
      ['first b', ['b1']],
    ]),
  ]);
  select(runtime, 'first a', 0, 3);
  const touch = actions(runtime, { alive: () => false });
  expect(touch.table.available()).toBe(false);
  expect(touch.table.convert()).toBe(false);
});

// Paired with paste-typeahead.source-controls.test.tsx (the same rows): the
// text lands literally and no inline-menu trigger fires, through the same
// registerInlineMenuTrigger listener the native inline-search hosts attach.
for (const [pasted, expected] of [
  ['/table', '/table beta'],
  ['@someone', '@someone beta'],
  [':smile:', ':smile: beta'],
] as const) {
  test(`native touch Paste of '${pasted}' is literal and opens no inline menu, as Source`, async () => {
    const runtime = mountSession([paragraph('alphaId1', 'Alpha beta')]);
    const triggers: string[] = [];
    for (const symbol of ['/', '@', ':'])
      createInlineMenuTriggerListener(symbol, () => triggers.push(symbol))(
        runtime.view.root,
        null
      );
    select(runtime, 'Alpha beta', 0, 5);
    pasteboard.read.mockResolvedValue(pasted);
    await actions(runtime).paste(() => {});
    expect(blocks(runtime)).toEqual([['paragraph', expected]]);
    expect(triggers).toEqual([]);
  });
}
