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
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { Gif } from '../../plugins/gif';
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
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
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
        captured !== undefined && runtime.view.node(captured) !== undefined;
      return gif.host.commit(insertion, GIF, FILE_ID, vi.fn());
    },
    { before: () => runtime.port.setState(REPLACED) }
  );
  await expect(pending).resolves.toBe(false);
  expect(presentAtEnqueue).toBe(true);
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
  runtime.caret(0, 5);
  const onInserted = vi.fn();
  const result = await Promise.resolve(
    gif.host.commit(prepared(gif), GIF, FILE_ID, onInserted)
  ).catch((error: unknown) => ({ rejected: error }));
  // The document references the file, so the picker must keep the upload.
  expect(result).toBe(true);
  expect(onInserted).toHaveBeenCalledTimes(1);
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
