import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test } from 'vitest';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(import.meta.dirname, 'wasm/document_session_wasm_bg.wasm')
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'comment-request',
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
          'comment-request'
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
            children: [{ type: 'text', version: 1, text: 'Alpha beta' }],
          },
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'Gamma' }],
          },
        ],
      },
    })
  );
  const texts = [...runtime.view.mirror.values()].filter(
    (node) => node.kind === 'text'
  );
  return { ...runtime, root, texts };
}

test('selection capture returns durable cursors and the exact model text', async () => {
  const runtime = mount();
  try {
    const [first, second] = runtime.texts;
    if (!first || !second) throw new Error('Missing actual native text');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: first.key, offset: 6, type: 'text' },
      focus: { key: second.key, offset: 3, type: 'text' },
    });
    const selection = runtime.port.commentSelection();
    expect(selection?.text).toBe('beta\nGam');
    expect(selection?.anchor.nodeId).toEqual(expect.any(String));
    expect(selection?.anchor.cursor.length).toBeGreaterThan(0);
    expect(selection?.focus.nodeId).not.toBe(selection?.anchor.nodeId);

    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: first.key, offset: 2, type: 'text' },
      focus: { key: first.key, offset: 2, type: 'text' },
    });
    expect(runtime.port.commentSelection()?.text).toBe('');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('comment requests settle with their own replies and reject after close', async () => {
  const runtime = mount();
  const [first] = runtime.texts;
  if (!first) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: first.key, offset: 0, type: 'text' },
    focus: { key: first.key, offset: 5, type: 'text' },
  });
  const selection = runtime.port.commentSelection();
  if (!selection) throw new Error('Missing selection cursors');
  const [added, removed] = await Promise.all([
    runtime.port.comment('mark-a', { kind: 'add', ...selection }),
    runtime.port.comment('mark-b', { kind: 'remove' }),
  ]);
  // Without a transport, publication cannot catch up with the server first.
  expect([added, removed]).toEqual([
    { kind: 'refused', reason: 'CatchupFailed' },
    { kind: 'refused', reason: 'CatchupFailed' },
  ]);
  await runtime.close();
  runtime.root.remove();
  await expect(
    Promise.resolve().then(() =>
      runtime.port.comment('mark-c', { kind: 'remove' })
    )
  ).rejects.toThrow();
});
