/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  EditorInputMsg,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
import { createViewCommand } from './commands';
import { NativeEnterDispatcher } from './native-enter';
import { NativeEnterOutput } from './native-enter-output';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';

const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (locksDescriptor)
    Object.defineProperty(navigator, 'locks', locksDescriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});

function mount(commands = true) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'observer-lifetime',
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
      nativeCommands: commands ? native : undefined,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'observer-lifetime'
        ),
    }
  );
  return { ...runtime, root };
}

function state(text: string) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text }],
        },
      ],
    },
  });
}

function input(runtime: ReturnType<typeof mount>, text: string) {
  return runtime.executor.session.input(
    SessionInputMsg.encode({
      ...emptyInput(2),
      editor: EditorInputMsg.fromEditorSetState({ json: state(text) }),
    }),
    runtime.executor.now(),
    Date.now()
  );
}

/** Guard-only integration: genuine flags continue through the existing executor.
 * No e69 main-commit receipt exists, so this never proves future receipt ordering. */
function notifyAfterNativeReturn(
  runtime: ReturnType<typeof mount>,
  notify: () => void
) {
  let failure: { error: unknown } | undefined;
  runtime.executor.runSettled(
    () => {
      const flags = input(runtime, 'current');
      try {
        NativeEnterDispatcher.forModule(native).withPureInputCommitObserver(
          runtime.executor.session,
          notify
        );
      } catch (error) {
        failure = { error };
      }
      return flags;
    },
    () => {}
  );
  return failure;
}

test('pure observer has no issued scope and rejects raw reads, mutation and free before bindgen', async () => {
  const runtime = mount();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  try {
    const failure = notifyAfterNativeReturn(runtime, () => {
      expect(dispatcher.activeScope()).toBeUndefined();
      expect(runtime.port.nativeEnter?.scope()).toBeUndefined();
      expect(dispatcher.pureInputCommitObserverActive()).toBe(true);
      expect(() => runtime.executor.session.listenerTable()).toThrow(
        'receiver'
      );
      expect(() => input(runtime, 'forbidden')).toThrow('receiver');
      expect(() => runtime.executor.session.free()).toThrow('receiver');
      expect(() => runtime.port.setState(state('also forbidden'))).toThrow();
    });
    expect(failure).toBeUndefined();
    expect(runtime.root.textContent).toBe('current');
    expect(dispatcher.pureInputCommitObserverActive()).toBe(false);
    expect(runtime.executor.session.listenerTable().length).toBeGreaterThan(0);
    runtime.port.setState(state('next'));
    expect(runtime.root.textContent).toBe('next');
    expect(NativeEnterDispatcher.forModule(native)).toBe(dispatcher);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const action of ['close', 'dispose', 'keep'] as const) {
  for (const error of [undefined, null, { opaque: 'observer' }]) {
    test(`${action} and observer throw ${String(error)} restore the phase and preserve drain before free`, async () => {
      const runtime = mount();
      const dispatcher = NativeEnterDispatcher.forModule(native);
      const trace: string[] = [];
      const originalTake = runtime.executor.session.takeOutput.bind(
        runtime.executor.session
      );
      const take = vi
        .spyOn(runtime.executor.session, 'takeOutput')
        .mockImplementation(() => {
          const bytes = originalTake();
          const copy = bytes.slice();
          const output = decodeOutput(copy);
          trace.push('output.copied');
          // Executor close uses this exact real Stop request and reply.
          if (
            output.viewEffects.some(
              (e) => e.kind === 5 && e.code === 0 && e.request === 0xffff_ffff
            )
          )
            trace.push('stop.copied');
          return bytes;
        });
      const originalFree = runtime.executor.session.free.bind(
        runtime.executor.session
      );
      const free = vi
        .spyOn(runtime.executor.session, 'free')
        .mockImplementation(() => {
          originalFree();
          trace.push('free');
        });
      const originalDrain = NativeEnterOutput.prototype.afterDrain;
      const drain = vi
        .spyOn(NativeEnterOutput.prototype, 'afterDrain')
        .mockImplementation(function (this: NativeEnterOutput, ...args) {
          try {
            return originalDrain.apply(this, args);
          } finally {
            trace.push('drain');
          }
        });
      const retirement = vi.spyOn(dispatcher, 'requestRetirement');
      let closed: Promise<void> | undefined;
      try {
        const failure = notifyAfterNativeReturn(runtime, () => {
          if (action === 'close') closed = runtime.close();
          if (action === 'dispose') runtime.view.dispose();
          expect(trace).not.toContain('free');
          throw error;
        });
        expect(failure).toEqual({ error });
        expect(failure?.error).toBe(error);
        expect(dispatcher.pureInputCommitObserverActive()).toBe(false);
        expect(retirement).not.toHaveBeenCalled();
        if (action === 'keep') {
          runtime.port.setState(state('healthy next input'));
          expect(runtime.root.textContent).toBe('healthy next input');
        }
        await (closed ?? runtime.close());
        expect(trace.filter((value) => value === 'free')).toHaveLength(1);
        expect(trace.indexOf('free')).toBeGreaterThan(
          trace.lastIndexOf('output.copied')
        );
        expect(trace.indexOf('free')).toBeGreaterThan(
          trace.lastIndexOf('drain')
        );
        expect(trace).toContain('stop.copied');
      } finally {
        await runtime.close().catch(() => {});
        take.mockRestore();
        free.mockRestore();
        drain.mockRestore();
        retirement.mockRestore();
        runtime.root.remove();
      }
    });
  }
}

test.each(['same', 'other'] as const)(
  '%s owner cleanup is deferred once without inventing a scope',
  async (target) => {
    const a = mount(),
      b = mount();
    const runtime = target === 'same' ? a : b;
    const dispatcher = NativeEnterDispatcher.forModule(native);
    const session = runtime.executor.session;
    const owner = dispatcher.owner(session);
    const register = vi.spyOn(session, 'registerViewEnter');
    const unregister = vi.spyOn(session, 'unregisterViewEnter');
    const release = dispatcher.register(session, owner, () => true, 3);
    const handles = register.mock.results.map((result) => result.value);
    try {
      const failure = notifyAfterNativeReturn(a, () => {
        expect(dispatcher.activeScope()).toBeUndefined();
        release();
        release();
        expect(unregister).not.toHaveBeenCalled();
      });
      expect(failure).toBeUndefined();
      expect(unregister.mock.calls.map(([handle]) => handle)).toEqual(handles);
      expect(
        new Set(unregister.mock.calls.map(([handle]) => handle)).size
      ).toBe(handles.length);
      expect(dispatcher.hasListeners(owner)).toBe(false);
    } finally {
      release();
      register.mockRestore();
      unregister.mockRestore();
      await a.close();
      await b.close();
      a.root.remove();
      b.root.remove();
    }
  }
);

test('actual idle cleanup cancels its deferred ticket before same-identity re-registration', async () => {
  const runtime = mount();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const owner = dispatcher.owner(runtime.executor.session);
  let calls = 0;
  const callback = () => {
    calls++;
    return true;
  };
  const release = dispatcher.register(
    runtime.executor.session,
    owner,
    callback,
    3
  );
  let later = () => {};
  try {
    runtime.executor.runSettled(
      () => {
        const flags = input(runtime, 'current');
        dispatcher.withPureInputCommitObserver(
          runtime.executor.session,
          release
        );
        // Actual returned-native/pre-consume gap; no fabricated flags or scope.
        release();
        later = dispatcher.register(
          runtime.executor.session,
          owner,
          callback,
          3
        );
        return flags;
      },
      () => {}
    );
    expect(runtime.port.nativeEnter?.dispatch()).toBe(true);
    expect(calls).toBe(1);
    release();
    expect(dispatcher.hasListeners(owner)).toBe(false);
  } finally {
    later();
    release();
    await runtime.close();
    runtime.root.remove();
  }
});

test('other-owner terminal close before deferred component cleanup makes no freed receiver call', async () => {
  const a = mount(),
    b = mount();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const release = dispatcher.register(
    b.executor.session,
    dispatcher.owner(b.executor.session),
    () => true,
    3
  );
  const originalFree = b.executor.session.free.bind(b.executor.session);
  let freed = false;
  const free = vi.spyOn(b.executor.session, 'free').mockImplementation(() => {
    originalFree();
    freed = true;
  });
  const originalUnregister = b.executor.session.unregisterViewEnter.bind(
    b.executor.session
  );
  const unregister = vi
    .spyOn(b.executor.session, 'unregisterViewEnter')
    .mockImplementation((handle) => {
      expect(freed).toBe(false);
      originalUnregister(handle);
    });
  let closed: Promise<void> | undefined;
  try {
    expect(
      notifyAfterNativeReturn(a, () => {
        closed = b.close();
        release();
      })
    ).toBeUndefined();
    await closed;
    expect(freed).toBe(true);
    const count = unregister.mock.calls.length;
    release();
    expect(unregister).toHaveBeenCalledTimes(count);
  } finally {
    release();
    await a.close();
    await b.close().catch(() => {});
    free.mockRestore();
    unregister.mockRestore();
    a.root.remove();
    b.root.remove();
  }
});

test('a real native decode throw still drains observer cleanup and close without synthetic flags', async () => {
  const runtime = mount();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const owner = dispatcher.owner(runtime.executor.session);
  const release = dispatcher.register(
    runtime.executor.session,
    owner,
    () => true,
    3
  );
  let nativeFailure: { error: unknown } | undefined;
  let outerFailure: { error: unknown } | undefined;
  let closed: Promise<void> | undefined;
  try {
    try {
      runtime.executor.runSettled(
        () => {
          try {
            runtime.executor.session.input(
              new Uint8Array(),
              runtime.executor.now(),
              Date.now()
            );
          } catch (error) {
            nativeFailure = { error };
          }
          if (!nativeFailure)
            throw new Error('The actual malformed native input must throw');
          dispatcher.withPureInputCommitObserver(
            runtime.executor.session,
            () => {
              release();
              closed = runtime.close();
            }
          );
          throw nativeFailure.error;
        },
        () => {}
      );
    } catch (error) {
      outerFailure = { error };
    }
    expect(nativeFailure).toBeDefined();
    expect(outerFailure?.error).toBe(nativeFailure?.error);
    await closed;
    expect(dispatcher.pureInputCommitObserverActive()).toBe(false);
    expect(dispatcher.takeTeardowns()).toEqual([]);
  } finally {
    release();
    await runtime.close().catch(() => {});
    runtime.root.remove();
  }
});

test('queued observer phases and a cancelled entry leave no registration teardown stranded', async () => {
  const runtime = mount();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const owner = dispatcher.owner(runtime.executor.session);
  const first = dispatcher.register(
    runtime.executor.session,
    owner,
    () => true,
    3
  );
  let queued = 0,
    cancelled = 0,
    rejectedFactory = 0;
  let cancelledResult: unknown;
  let closed: Promise<void> | undefined;
  try {
    runtime.executor.runSettled(
      () => {
        const flags = input(runtime, 'prefix');
        runtime.executor.runSettled(
          () => {
            const nextFlags = input(runtime, 'queued');
            dispatcher.withPureInputCommitObserver(
              runtime.executor.session,
              () => {
                queued++;
                first();
                closed = runtime.close();
                expect(() =>
                  runtime.port.inputSettled(() => {
                    rejectedFactory++;
                    throw new Error('Observer cannot admit a Port factory');
                  })
                ).toThrow();
              }
            );
            return nextFlags;
          },
          () => {}
        );
        return flags;
      },
      () => {}
    );
    // close.finish has now run at the real returned-native drain fence.
    runtime.executor.runSettled(
      () => {
        cancelled++;
        throw new Error('Cancelled entry must never execute');
      },
      (result) => {
        cancelledResult = result;
      }
    );
    await closed;
    expect(queued).toBe(1);
    expect(cancelled).toBe(0);
    expect(rejectedFactory).toBe(0);
    expect(cancelledResult).toEqual({ status: 'cancelled', reason: 'closing' });
    expect(dispatcher.pureInputCommitObserverActive()).toBe(false);
    expect(dispatcher.takeTeardowns()).toEqual([]);
  } finally {
    first();
    await runtime.close().catch(() => {});
    runtime.root.remove();
  }
});

test('no-command session is refused even when its generated constructor already has a module guard', async () => {
  const runtime = mount(false);
  const dispatcher = NativeEnterDispatcher.forModule(native);
  let invoked = false;
  try {
    expect(() =>
      dispatcher.withPureInputCommitObserver(runtime.executor.session, () => {
        invoked = true;
      })
    ).toThrow('actual session binding');
    expect(invoked).toBe(false);
    expect(dispatcher.pureInputCommitObserverActive()).toBe(false);
    runtime.port.setState(state('still healthy'));
    expect(runtime.root.textContent).toBe('still healthy');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('real Enter callback keeps its issued scope and scoped retirement path', async () => {
  const runtime = mount();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const retirement = vi.spyOn(dispatcher, 'requestRetirement');
  const Enter = createViewCommand(
    'Key(Enter)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  let closed: Promise<void> | undefined;
  const release = runtime.view.registerViewCommand(
    Enter,
    () => {
      expect(dispatcher.activeScope()?.owner).toBeGreaterThan(0n);
      expect(() =>
        dispatcher.withPureInputCommitObserver(
          runtime.executor.session,
          () => {}
        )
      ).toThrow();
      closed = runtime.close();
      return true;
    },
    3
  );
  try {
    runtime.port.setState(state('before'));
    expect(runtime.port.nativeEnter?.dispatch()).toBe(true);
    await closed;
    expect(retirement).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await runtime.close().catch(() => {});
    retirement.mockRestore();
    runtime.root.remove();
  }
});

test('draft quote query preserves callback lease and next healthy listener', async () => {
  const runtime = mount();
  const Enter = createViewCommand(
    'Key(Enter)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  let release = () => {};
  let calls = 0;
  try {
    runtime.port.setState(state('before'));
    const node = [...runtime.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!node) throw new Error('Missing native text');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: node.key, offset: 0, type: 'text' },
      focus: { key: node.key, offset: 6, type: 'text' },
    });
    const cursors = runtime.port.commentSelection();
    if (!cursors) throw new Error('Missing durable cursors');
    const message = {
      kind: 12,
      key: 0,
      flags: 0,
      text: JSON.stringify({
        anchor: {
          nodeId: cursors.anchor.nodeId,
          cursor: [...cursors.anchor.cursor],
        },
        focus: {
          nodeId: cursors.focus.nodeId,
          cursor: [...cursors.focus.cursor],
        },
        markId: 'draft',
      }),
    };
    release = runtime.view.registerViewCommand(
      Enter,
      () => {
        const scope = runtime.port.nativeEnter?.scope();
        const pending = runtime.port.nativeEnter?.pendingSelection();
        expect(scope).toBeDefined();
        expect(() => runtime.port.query(message)).toThrow();
        expect(runtime.port.nativeEnter?.scope()).toBe(scope);
        expect(runtime.port.nativeEnter?.pendingSelection()).toEqual(pending);
        calls++;
        return true;
      },
      3
    );
    expect(runtime.port.nativeEnter?.dispatch()).toBe(true);
    expect(calls).toBe(1);
    expect(runtime.port.nativeEnter?.scope()).toBeUndefined();
    const before = runtime.view.query.serializedState();
    const reply = runtime.port.query(message);
    expect([reply.count, reply.text]).toEqual([1, 'before']);
    expect(runtime.view.query.serializedState()).toBe(before);
    expect(runtime.port.nativeEnter?.dispatch()).toBe(true);
    expect(calls).toBe(2);
  } finally {
    release();
    await runtime.close();
    runtime.root.remove();
  }
});
