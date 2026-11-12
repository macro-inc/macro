import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { staticFileIdEndpoint } from '@core/constant/servers';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
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

const GIF: Gif = {
  id: 'klipy-1',
  title: 'waving cat',
  url: 'https://example.test/cat.gif',
  previewUrl: 'https://example.test/cat-preview.gif',
  width: 480,
  height: 270,
};
const FILE_ID = '00000000-0000-4000-8000-000000000041';

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
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
          'native-gif'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'first' }],
          },
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'second' }],
          },
        ],
      },
    })
  );
  const texts = [...runtime.view.mirror.values()].filter(
    (node) => node.kind === 'text'
  );
  const caret = (index: number, offset: number) => {
    const text = texts[index];
    if (!text) throw new Error('Missing actual text');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset, type: 'text' },
      focus: { key: text.key, offset, type: 'text' },
    });
  };
  runtime.view.focus();
  return { ...runtime, root, texts, caret };
}

/** The serialized root's top-level children, raw. */
function children(runtime: ReturnType<typeof mount>) {
  return JSON.parse(runtime.view.query.serializedState()).root.children;
}

test('the GIF request is refused before projection and before the picker registers', () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  const onOpen = vi.fn();
  expect(gif.requestOpen()).toBe(false);
  gif.bindView(runtime.view);
  expect(gif.requestOpen()).toBe(false);
  createRoot((dispose) => {
    gif.host.registerPicker(() => false, onOpen);
    expect(gif.requestOpen()).toBe(false);
    dispose();
  });
  expect(onOpen).not.toHaveBeenCalled();
  gif.dispose();
});

test('an editable bound view opens the registered picker', () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  const onOpen = vi.fn();
  createRoot((dispose) => {
    gif.host.registerPicker(() => true, onOpen);
    expect(gif.requestOpen()).toBe(true);
    dispose();
  });
  expect(onOpen).toHaveBeenCalledTimes(1);
  gif.dispose();
  expect(gif.requestOpen()).toBe(false);
});

test('commit inserts the Source GIF image at the caret captured on open', async () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  runtime.caret(0, 5);
  const target = gif.host.captureTarget();
  // The model caret moves elsewhere, then the picker's search field takes
  // focus, so the browser selection leaves the editor root entirely.
  // End of "second": a live-caret insert would land after the second paragraph.
  runtime.caret(1, 6);
  const moved = runtime.view.selection().selection;
  expect(moved.kind === 'range' && moved.anchor.key).toBe(
    runtime.texts[1]?.key
  );
  const search = document.createElement('input');
  document.body.append(search);
  search.focus();
  window.getSelection()?.removeAllRanges();
  const insertion = gif.host.prepareInsertion(target, () => true);
  if (!insertion) throw new Error('Expected an insertion');
  expect(gif.host.isCurrent(insertion)).toBe(true);
  const onInserted = vi.fn();
  await expect(
    gif.host.commit(insertion, GIF, FILE_ID, onInserted)
  ).resolves.toBe(true);
  expect(onInserted).toHaveBeenCalledTimes(1);
  const nodes = children(runtime);
  const index = nodes.findIndex(
    (node: { type: string }) => node.type === 'image'
  );
  // Inserted after the first paragraph, where the captured caret was.
  expect(index).toBe(1);
  expect(nodes[index]).toMatchObject({
    srcType: 'sfs',
    id: FILE_ID,
    url: staticFileIdEndpoint(FILE_ID),
    alt: GIF.title,
    width: 480,
    height: 270,
    constrainedWidth: 400,
    constrainedHeight: 225,
  });
  gif.dispose();
});

test('a captured caret whose text was removed does not receive the image', async () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  runtime.caret(0, 5);
  const target = gif.host.captureTarget();
  const insertion = gif.host.prepareInsertion(target, () => true);
  if (!insertion) throw new Error('Expected an insertion');
  runtime.port.setState(
    JSON.stringify({
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
    })
  );
  const onInserted = vi.fn();
  await expect(
    Promise.resolve(gif.host.commit(insertion, GIF, FILE_ID, onInserted))
  ).resolves.toBe(false);
  expect(onInserted).not.toHaveBeenCalled();
  expect(
    children(runtime).some((node: { type: string }) => node.type === 'image')
  ).toBe(false);
  gif.dispose();
});

test('insertion is refused when editing is off, and stale after dispose', () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  runtime.caret(0, 5);
  const target = gif.host.captureTarget();
  expect(gif.host.prepareInsertion(target, () => false)).toBeUndefined();
  const insertion = gif.host.prepareInsertion(target, () => true);
  if (!insertion) throw new Error('Expected an insertion');
  gif.dispose();
  expect(gif.host.isCurrent(insertion)).toBe(false);
});

test('document changes, not caret moves, cancel an in-flight insertion', async () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  runtime.caret(0, 5);
  const insertion = gif.host.prepareInsertion(
    gif.host.captureTarget(),
    () => true
  );
  if (!insertion) throw new Error('Expected an insertion');
  const onDirty = vi.fn();
  const stop = gif.host.subscribeChanges(insertion, onDirty);
  runtime.caret(1, 2);
  expect(onDirty).not.toHaveBeenCalled();
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'edited' }],
          },
        ],
      },
    })
  );
  expect(onDirty).toHaveBeenCalled();
  stop();
  gif.dispose();
});

test('focus leaving the root for the panel does not propagate; cleanup cancels the upload', () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  const panel = document.createElement('div');
  const input = document.createElement('input');
  panel.append(input);
  document.body.append(panel);
  const outer = vi.fn();
  document.body.addEventListener('focusout', outer);
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
  document.body.removeEventListener('focusout', outer);
  gif.dispose();
});
