/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { StorageAdapter } from '@macro-inc/collaboration/session/storage';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as nativeModule from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from './local-session-view';
import { mountSessionView } from './session-view';
import { createViewCommand } from './view/commands';
import { createBuiltinRegistry } from './view/node-views/builtins';
import { registerMacroElementViews } from './view/node-views/macro';
import { initializeNativeSurfaceTests } from './view/test/native-surface';

beforeAll(initializeNativeSurfaceTests);
const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() =>
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  })
);
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

test.each(['token', 'socket-url'] as const)(
  'disposed UI does not receive pending %s I/O output and close still drains storage',
  async (fault) => {
    const doc = crypto.randomUUID(),
      owner = crypto.randomUUID();
    const token = Promise.withResolvers<{ token: string; access: number }>();
    const requested = Promise.withResolvers<void>();
    const telemetry = new SessionTelemetry(NOOP_SPAN);
    const storage = new StorageAdapter(doc, owner, 'fixture-user', locks);
    const executed = vi.spyOn(storage, 'execute');
    const errors: unknown[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const runtime = mountSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'disposed-session',
        theme: {},
        editable: false,
        preset: 'rich',
        onError: (error) => errors.push(error),
      },
      {
        doc,
        owner,
        user: 'fixture-user',
        locks,
        storage,
        telemetry,
        create: (now, wall) =>
          nativeModule.EditorSession.createMacro(
            ABI_MAJOR,
            SessionConfigMsg.encode({
              doc,
              session: owner,
              user: 'fixture-user',
              peers: [7n, 8n, 9n],
              access: Access.Edit,
              transport: Transport.Direct,
              durable: true,
              chatter: false,
              headless: false,
              viewEngine: 1,
              viewOs: 0,
              token: '',
              traceparent: '',
              coalesce: 25,
              snapshotInterval: 15000,
              observed: [],
            }),
            now,
            wall
          ),
        auth: {
          token: () => {
            requested.resolve();
            return token.promise;
          },
          subscribe: () => () => {},
        },
        socketUrl() {
          throw new Error('Fixture socket URL unavailable');
        },
      },
      nativeModule
    );
    const order: string[] = [];
    const retired = runtime.executor.session.retireViewObservation.bind(
      runtime.executor.session
    );
    const retire = vi
      .spyOn(runtime.executor.session, 'retireViewObservation')
      .mockImplementation(() => {
        order.push('retire');
        retired();
      });
    const take = runtime.executor.session.takeOutput.bind(
      runtime.executor.session
    );
    vi.spyOn(runtime.executor.session, 'takeOutput').mockImplementation(() => {
      order.push('takeOutput');
      return take();
    });
    const apply = vi.spyOn(runtime.view, 'apply');
    try {
      await requested.promise;
      runtime.view.dispose();
      expect(retire).not.toHaveBeenCalled();
      const before = apply.mock.calls.length;
      if (fault === 'token')
        token.reject(new Error('Fixture authorization unavailable'));
      else token.resolve({ token: 'fixture-token', access: Access.Edit });
      await vi.waitFor(() => expect(retire).toHaveBeenCalledOnce());
      await runtime.close();
      expect(apply).toHaveBeenCalledTimes(before);
      expect(order[0]).toBe('retire');
      expect(order).toContain('takeOutput');
      expect(retire).toHaveBeenCalledOnce();
      expect(executed).toHaveBeenCalled();
      expect(errors).toEqual([]);
      expect(runtime.view.isMounted).toBe(false);
      const lockState = await locks.query();
      expect(
        lockState.held.some((lock) => lock.name === `macro-wal:${doc}:${owner}`)
      ).toBe(false);
    } finally {
      await runtime.close();
      telemetry.close();
      root.remove();
      vi.restoreAllMocks();
    }
  }
);

test('direct disposal inside a real native Escape callback defers observation retirement until receiver return', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'dispose-in-command',
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
      nativeCommands: nativeModule,
      create: (config, now, wall) =>
        nativeModule.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'dispose-in-command'
        ),
    }
  );
  let insideCallback = false;
  const events: string[] = [];
  const retireOriginal = runtime.executor.session.retireViewObservation.bind(
    runtime.executor.session
  );
  const retire = vi
    .spyOn(runtime.executor.session, 'retireViewObservation')
    .mockImplementation(() => {
      expect(insideCallback).toBe(false);
      events.push('retire');
      retireOriginal();
    });
  const output = runtime.executor.session.takeOutput.bind(
    runtime.executor.session
  );
  vi.spyOn(runtime.executor.session, 'takeOutput').mockImplementation(() => {
    events.push('takeOutput');
    return output();
  });
  const command = createViewCommand(
    'Key(Escape)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  if (!runtime.view.node(0)) throw new Error('Missing actual initialized root');
  const listener = vi.fn(() => {
    insideCallback = true;
    try {
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: 0, offset: 0, type: 'element' },
        focus: { key: 0, offset: 0, type: 'element' },
      });
      runtime.view.dispose();
      expect(retire).not.toHaveBeenCalled();
      return true;
    } finally {
      insideCallback = false;
    }
  });
  try {
    runtime.view.registerViewCommand(command, listener, 3);
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(events[0]).toBe('retire');
    expect(events).toContain('takeOutput');
    await runtime.close();
    expect(retire).toHaveBeenCalledOnce();
  } finally {
    await runtime.close();
    root.remove();
    vi.restoreAllMocks();
  }
});
