import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { SessionInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import type { ExecutorSettlement } from '@macro-inc/collaboration/session/executor';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import {
  createBuiltinRegistry,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { waitFor } from '@solidjs/testing-library';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createRustEditorSession } from './create-editor-session';
import * as module from './wasm/document_session_wasm.js';

beforeAll(() => {
  module.initSync({
    module: readFileSync(
      resolve(import.meta.dirname, './wasm/document_session_wasm_bg.wasm')
    ),
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
});
afterEach(() => vi.restoreAllMocks());

function mount(
  loadCachedSnapshot: () => Promise<Uint8Array | undefined>,
  replaceDuringInstall = false
) {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const options: Parameters<typeof createRustEditorSession>[0] = {
    module,
    root,
    registry: registerMacroElementViews(createBuiltinRegistry()),
    view: {
      namespace: crypto.randomUUID(),
      theme: {},
      editable: false,
      preset: 'rich',
      onError: (error) => errors.push(error),
    },
    documentId: crypto.randomUUID(),
    user: 'fixture-user',
    access: 2,
    authorization: {
      async token() {
        throw new Error('Fixture remains offline');
      },
      subscribe: () => () => {},
    },
    viewEngine: 1,
    viewOs: 0,
    span: NOOP_SPAN,
    onStatus() {},
    loadCachedSnapshot,
    installOverlays: replaceDuringInstall
      ? () => {
          options.loadCachedSnapshot = async () => undefined;
          return { dispose() {}, focusAtEnd() {} };
        }
      : undefined,
  };
  const runtime = createRustEditorSession(options);
  const received: ReturnType<typeof SessionInputMsg.decode>[] = [];
  const input = runtime.executor.session.input.bind(runtime.executor.session);
  vi.spyOn(runtime.executor.session, 'input').mockImplementation(
    (bytes, ...args) => {
      const message = SessionInputMsg.decode(bytes);
      if (message.kind === 1) received.push(message);
      return input(bytes, ...args);
    }
  );
  return { runtime, root, received, errors, rawInput: input };
}

test('a real offline native factory initializes and paints an actual Source cached snapshot', async () => {
  const snapshot = await markdownToLoroSnapshot('Cached source paragraph.');
  if (!snapshot) throw new Error('Source snapshot production failed');
  const loader = vi.fn(async () => snapshot);
  const mounted = mount(loader, true);
  try {
    await waitFor(() =>
      expect(mounted.root.textContent).toBe('Cached source paragraph.')
    );
    expect(loader).toHaveBeenCalledOnce();
    expect(mounted.runtime.view.mirror.keyGeneration).not.toBeNull();
    expect(mounted.runtime.view.node(0)).toBeDefined();
    expect(mounted.received).toHaveLength(1);
    expect(mounted.received[0].code).toBe(1);
    expect(mounted.received[0].bytes).toEqual(snapshot);
    expect(mounted.errors).toEqual([]);
  } finally {
    await mounted.runtime.close();
    mounted.root.remove();
  }
});

test('a cache result after owning close never enters the real native receiver', async () => {
  const snapshot = await markdownToLoroSnapshot('Late source paragraph.');
  if (!snapshot) throw new Error('Source snapshot production failed');
  const cached = Promise.withResolvers<Uint8Array>();
  const mounted = mount(() => cached.promise);
  try {
    await mounted.runtime.close();
    cached.resolve(snapshot);
    await cached.promise;
    await Promise.resolve();
    expect(mounted.received).toHaveLength(0);
    expect(mounted.root.textContent).toBe('');
  } finally {
    await mounted.runtime.close();
    mounted.root.remove();
  }
});

test('an accepted queued seed runs with the live view before requested close drains Stop and free', async () => {
  const snapshot = await markdownToLoroSnapshot('Queued source paragraph.');
  if (!snapshot) throw new Error('Source snapshot production failed');
  const cached = Promise.withResolvers<Uint8Array>();
  const mounted = mount(() => cached.promise);
  const { runtime } = mounted;
  const events: string[] = [];
  const settlements: ExecutorSettlement[] = [];
  const actualSeedFlags: number[] = [];
  let closing: Promise<void> | undefined;
  const input = mounted.rawInput;
  vi.spyOn(runtime.executor.session, 'input').mockImplementation(
    (bytes, ...args) => {
      const message = SessionInputMsg.decode(bytes);
      if (message.kind === 1) {
        events.push('cached-seed');
        expect(runtime.view.isMounted).toBe(true);
      }
      if (message.kind === 5) events.push('stop');
      const flags = input(bytes, ...args);
      if (message.kind === 1) actualSeedFlags.push(flags);
      return flags;
    }
  );
  const free = runtime.executor.session.free.bind(runtime.executor.session);
  vi.spyOn(runtime.executor.session, 'free').mockImplementation(() => {
    events.push('free');
    free();
  });
  const runSettled = runtime.executor.runSettled.bind(runtime.executor);
  vi.spyOn(runtime.executor, 'runSettled').mockImplementationOnce(
    (call, notify, options) => {
      runtime.executor.run(() => {
        runSettled(
          call,
          (result) => {
            settlements.push(result);
            notify(result);
          },
          options
        );
        closing = runtime.close();
        expect(events).not.toContain('cached-seed');
        return runtime.executor.session.tick(
          runtime.executor.now(),
          Date.now()
        );
      });
    }
  );
  try {
    cached.resolve(snapshot);
    await waitFor(() => expect(closing).toBeDefined());
    await closing;
    expect(actualSeedFlags).toHaveLength(1);
    expect(settlements).toEqual([
      { status: 'success', flags: actualSeedFlags[0] },
    ]);
    expect(events).toEqual(['cached-seed', 'stop', 'free']);
    expect(runtime.view.isMounted).toBe(false);
    expect(mounted.errors).toEqual([]);
  } finally {
    await runtime.close();
    mounted.root.remove();
  }
});
