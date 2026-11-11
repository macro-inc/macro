/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { snapshotWriteLock } from '@macro-inc/collaboration/collab/snapshot-store';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
  EditorInputMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  type ExecutorOptions,
  SessionExecutor,
} from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { StorageAdapter } from '@macro-inc/collaboration/session/storage';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { NOOP_SPAN } from '@macro-inc/observability';
import { onCleanup } from 'solid-js';
import { beforeAll, expect, test, vi } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountSessionView } from '../session-view';
import { createViewCommand } from './commands';
import { EditorView } from './editor-view';
import { NativeEnterDispatcher } from './native-enter';
import { createBuiltinRegistry } from './node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from './node-views/macro';
import type { NodeViewRegistry } from './registry';

beforeAll(() =>
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  })
);

const enter = createViewCommand(
  'Key(Enter)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);
const initial = (text: string) =>
  JSON.stringify({
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

function mount(
  onError: (error: unknown) => void = (error) => {
    throw error;
  },
  bindEnter = true,
  setup: {
    registry?: NodeViewRegistry;
    auth?: ExecutorOptions<native.EditorSession>['auth'];
    storage?: (doc: string, owner: string) => StorageAdapter;
  } = {}
) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const owner = crypto.randomUUID();
  const runtime = mountSessionView(
    root,
    setup.registry ?? registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'enter-view',
      theme: {},
      editable: true,
      preset: 'rich',
      onError,
    },
    {
      doc: `enter-${owner}`,
      owner,
      user: 'fixture-user',
      locks,
      storage: setup.storage?.(`enter-${owner}`, owner),
      create: (now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          SessionConfigMsg.encode({
            doc: `enter-${owner}`,
            session: owner,
            user: 'fixture-user',
            peers: [7n, 8n, 9n],
            access: Access.Edit,
            transport: Transport.None,
            durable: false,
            chatter: false,
            headless: false,
            viewEngine: 1,
            viewOs: 0,
            token: '',
            traceparent: '',
            coalesce: 25,
            snapshotInterval: 0,
            observed: [],
          }),
          now,
          wall,
          'enter-view'
        ),
      auth: setup.auth ?? {
        token: async () => {
          throw new Error('No transport');
        },
        subscribe: () => () => {},
      },
      socketUrl: () => {
        throw new Error('No transport');
      },
      telemetry: new SessionTelemetry(NOOP_SPAN),
    },
    bindEnter ? native : undefined
  );
  runtime.executor.run(() =>
    runtime.executor.session.input(
      SessionInputMsg.encode(emptyInput(1)),
      runtime.executor.now(),
      Date.now()
    )
  );
  runtime.port.setState(initial('draft'));
  const leaf = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!leaf) throw new Error('Actual native text missing');
  const selection = {
    kind: 'range',
    anchor: { key: leaf.key, offset: 5, type: 'text' },
    focus: { key: leaf.key, offset: 5, type: 'text' },
  } satisfies Parameters<typeof runtime.port.selectionFromView>[0];
  runtime.port.selectionFromView(selection);
  return { ...runtime, root, leaf, selection };
}

test('Normal Enter occupies its actual native order and sees pending earlier changes', async () => {
  const runtime = mount();
  const order: string[] = [];
  const keyboard = new KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 13,
    ctrlKey: true,
  });
  try {
    runtime.view.registerViewCommand(
      enter,
      () => {
        order.push('first');
        runtime.port.nativeEnter?.dispatchScoped(
          EditorInputMsg.fromEditorCommand({
            command: CommandCode.InsertText,
            a: 0,
            b: 0,
            text: '!',
            selection: {
              kind: 0,
              anchor: { key: 0, offset: 0, type: 0 },
              focus: { key: 0, offset: 0, type: 0 },
              nodes: [],
              table: 0,
              dirty: false,
            },
            target: {
              kind: 0,
              anchor: { key: 0, offset: 0, type: 0 },
              focus: { key: 0, offset: 0, type: 0 },
              dirty: false,
              backward: false,
            },
            characterTarget: {
              kind: 0,
              anchor: { key: 0, offset: 0, type: 0 },
              focus: { key: 0, offset: 0, type: 0 },
              dirty: false,
              backward: false,
            },
          })
        );
        return false;
      },
      2
    );
    runtime.view.registerViewCommand(
      enter,
      (event) => {
        expect(event).toBe(keyboard);
        order.push(
          runtime.port.nativeEnter?.pendingText(runtime.leaf.key) ?? 'missing'
        );
        // Published view data remains published while pending scope reads advance.
        expect(runtime.view.text(runtime.leaf.key)).toBe('draft');
        return false;
      },
      2
    );
    runtime.view.registerViewCommand(
      enter,
      () => {
        order.push('last');
        return true;
      },
      2
    );
    expect(
      runtime.port.keyDown(13, 4, 0, 'Enter', runtime.selection, keyboard)
    ).toBe(true);
    expect(order).toEqual(['first', 'draft!', 'last']);
    expect(runtime.root.textContent).toBe('draft!');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('duplicate listener and stale cleanup follow Source set identity', async () => {
  const runtime = mount();
  const order: string[] = [];
  const first = () => {
    order.push('first');
    return false;
  };
  const later = () => {
    order.push('later');
    return false;
  };
  try {
    const removeFirst = runtime.view.registerViewCommand(enter, first, 4);
    runtime.view.registerViewCommand(enter, later, 4);
    const removeDuplicate = runtime.view.registerViewCommand(enter, first, 4);
    runtime.port.nativeEnter?.dispatch();
    expect(order).toEqual(['first', 'later']);
    removeDuplicate();
    runtime.view.registerViewCommand(enter, first, 4);
    order.length = 0;
    runtime.port.nativeEnter?.dispatch();
    expect(order).toEqual(['later', 'first']);
    removeFirst();
    order.length = 0;
    runtime.port.nativeEnter?.dispatch();
    expect(order).toEqual(['later']);
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('busy Enter rejects before retaining an event and unsupported callback inputs never queue', async () => {
  const runtime = mount();
  const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 });
  try {
    runtime.executor.run(() => {
      expect(() =>
        runtime.port.keyDown(13, 0, 0, 'Enter', runtime.selection, event)
      ).toThrow('Session executor is busy');
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    runtime.view.registerViewCommand(
      enter,
      (payload) => {
        expect(payload).toBeNull();
        expect(() =>
          runtime.port.setState(initial('incorrect queued replacement'))
        ).toThrow('Ordinary native admission during scoped callback');
        return true;
      },
      4
    );
    runtime.port.nativeEnter?.dispatch();
    runtime.executor.run(() =>
      runtime.executor.session.tick(runtime.executor.now(), Date.now())
    );
    expect(runtime.root.textContent).toBe('draft');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('an unbound Port cannot queue another owner input until the guarded tuple pops', async () => {
  const bound = mount();
  const ordinary = mount(undefined, false);
  try {
    bound.view.registerViewCommand(
      enter,
      () => {
        expect(() =>
          ordinary.port.setState(initial('incorrect queued replacement'))
        ).toThrow('Ordinary native admission during scoped callback');
        return true;
      },
      4
    );
    ordinary.executor.run(() => {
      expect(bound.port.nativeEnter?.dispatch()).toBe(true);
      return ordinary.executor.session.tick(
        ordinary.executor.now(),
        Date.now()
      );
    });
    expect(ordinary.root.textContent).toBe('draft');
    ordinary.port.setState(initial('allowed after callback'));
    expect(ordinary.root.textContent).toBe('allowed after callback');
  } finally {
    await bound.close();
    await ordinary.close();
    bound.root.remove();
    ordinary.root.remove();
  }
});

test.each([undefined, null, { reason: 'opaque' }])(
  'original callback cause follows accepted Diff and FIFO drain %j',
  async (cause) => {
    const order: string[] = [];
    const runtime = mount((error) => {
      order.push('error');
      expect(error).toBe(cause);
      throw { secondary: true };
    });
    try {
      runtime.view.onCommit(() => order.push('commit'));
      runtime.view.registerViewCommand(
        enter,
        () => {
          throw cause;
        },
        4
      );
      let caught = false;
      try {
        runtime.executor.run(() => {
          runtime.executor.run(() =>
            runtime.executor.session.viewCommandEnter(
              runtime.executor.now(),
              Date.now()
            )
          );
          return runtime.executor.session.input(
            SessionInputMsg.encode({
              ...emptyInput(2),
              editor: EditorInputMsg.fromEditorSetState({
                json: initial('accepted'),
              }),
            }),
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(runtime.root.textContent).toBe('accepted');
      expect(order.at(-1)).toBe('error');
      expect(order[0]).toBe('commit');
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  }
);

test.each([false, true])(
  'callback close defers actual cleanup and preserves Stop, throw=%j',
  async (throws) => {
    const cause = { reason: 'callback close' };
    const runtime = mount(() => {});
    const free = vi.spyOn(runtime.executor.session, 'free');
    let closing: Promise<void> | undefined;
    let stopped = false;
    const input = runtime.executor.session.input.bind(runtime.executor.session);
    const observe = vi
      .spyOn(runtime.executor.session, 'input')
      .mockImplementation((bytes, ...rest) => {
        if (SessionInputMsg.decode(bytes).kind === 5) stopped = true;
        return input(bytes, ...rest);
      });
    try {
      runtime.view.registerViewCommand(
        enter,
        () => {
          closing = runtime.close();
          expect(runtime.close()).toBe(closing);
          expect(runtime.view.isMounted).toBe(false);
          expect(free).not.toHaveBeenCalled();
          if (throws) throw cause;
          return true;
        },
        4
      );
      let caught = false;
      try {
        runtime.port.nativeEnter?.dispatch();
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(throws);
      expect(stopped).toBe(true);
      if (!closing) throw new Error('Callback did not close its view');
      await closing;
      expect(free).toHaveBeenCalledTimes(1);
      expect(runtime.view.isMounted).toBe(false);
    } finally {
      observe.mockRestore();
      await runtime.close();
      free.mockRestore();
      runtime.root.remove();
    }
  }
);

test('two actual failure packets retain FIFO causes and separately expose the second', async () => {
  const first = { reason: 'first' };
  const second = { reason: 'second' };
  const runtime = mount(() => {});
  let calls = 0;
  const metadata = vi.spyOn(runtime.executor.session, 'takeViewCommandFailure');
  try {
    runtime.view.registerViewCommand(
      enter,
      () => {
        throw ++calls === 1 ? first : second;
      },
      4
    );
    let caught = false;
    try {
      runtime.executor.run(() => {
        runtime.executor.run(() =>
          runtime.executor.session.viewCommandEnter(
            runtime.executor.now(),
            Date.now()
          )
        );
        runtime.executor.run(() =>
          runtime.executor.session.viewCommandEnter(
            runtime.executor.now(),
            Date.now()
          )
        );
        return runtime.executor.session.tick(
          runtime.executor.now(),
          Date.now()
        );
      });
    } catch (error) {
      caught = true;
      expect(error).toBe(first);
    }
    expect(caught).toBe(true);
    expect(calls).toBe(2);
    expect(metadata).toHaveBeenCalledTimes(4);
    const additional = runtime.port.nativeEnter?.takeFailure();
    expect(additional?.error).toBe(second);
    expect(additional?.scope).toBeGreaterThan(0n);
    expect(additional?.invocation).toBeGreaterThan(0n);
    expect(runtime.port.nativeEnter?.takeFailure()).toBeUndefined();
    expect(metadata).toHaveBeenCalledTimes(4);
  } finally {
    metadata.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('caught nested failure produces no false reported error and successful input makes no metadata query', async () => {
  const cause = { reason: 'caught nested' };
  const runtime = mount((error) => {
    throw error;
  });
  const metadata = vi.spyOn(runtime.executor.session, 'takeViewCommandFailure');
  let nested = false;
  try {
    const remove = runtime.view.registerViewCommand(enter, () => true, 4);
    runtime.port.nativeEnter?.dispatch();
    expect(metadata).not.toHaveBeenCalled();
    remove();
    runtime.view.registerViewCommand(
      enter,
      () => {
        if (nested) throw cause;
        nested = true;
        let caught = false;
        try {
          runtime.port.nativeEnter?.dispatch();
        } catch (error) {
          caught = true;
          expect(error).toBe(cause);
        }
        expect(caught).toBe(true);
        return true;
      },
      4
    );
    expect(runtime.port.nativeEnter?.dispatch()).toBe(true);
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(runtime.port.nativeEnter?.takeFailure()).toBeUndefined();
  } finally {
    metadata.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test.each([undefined, null, { reason: 'mount subscription' }])(
  'failed mount releases its actual native owner after close %j',
  async (cause) => {
    const dispatcher = NativeEnterDispatcher.forModule(native);
    const released = vi.spyOn(dispatcher, 'releaseOwner');
    const free = vi.spyOn(native.EditorSession.prototype, 'free');
    const actualClose = SessionExecutor.prototype.close;
    const closes: Promise<void>[] = [];
    const closing = vi
      .spyOn(SessionExecutor.prototype, 'close')
      .mockImplementation(function (this: SessionExecutor) {
        const pending = actualClose.call(this);
        closes.push(pending);
        return pending;
      });
    try {
      let caught = false;
      try {
        mount(undefined, true, {
          auth: {
            token: async () => {
              throw new Error('No transport');
            },
            subscribe: () => {
              throw cause;
            },
          },
        });
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(closes).toHaveLength(1);
      await closes[0];
      expect(free).toHaveBeenCalledTimes(1);
      expect(released).toHaveBeenCalledTimes(1);
      for (const root of document.body.children)
        expect(EditorView.fromDOM(root)).toBeNull();
    } finally {
      closing.mockRestore();
      free.mockRestore();
      released.mockRestore();
      document.body.replaceChildren();
    }
  }
);

test.each([undefined, null, { reason: 'component cleanup' }])(
  'a throwing Solid root cannot strand native listener ownership %j',
  async (cause) => {
    const registry = registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      {
        image: () => {
          onCleanup(() => {
            throw cause;
          });
          return document.createTextNode('cleanup probe');
        },
      }
    );
    const runtime = mount(undefined, true, { registry });
    const dispatcher = NativeEnterDispatcher.forModule(native);
    const owner = runtime.executor.session.viewCommandOwner();
    const free = vi.spyOn(runtime.executor.session, 'free');
    const released = vi.spyOn(dispatcher, 'releaseOwner');
    try {
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'image',
                version: 1,
                srcType: 'url',
                id: 'fixture-image',
                url: 'https://example.com/image',
                width: 320,
                height: 160,
                scale: 1,
                alt: '',
              },
            ],
          },
        })
      );
      runtime.view.registerViewCommand(enter, () => true, 4);
      let caught = false;
      try {
        await runtime.close();
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(free).toHaveBeenCalledTimes(1);
      expect(released).toHaveBeenCalledTimes(1);
      expect(dispatcher.hasListeners(owner)).toBe(false);
      expect(EditorView.fromDOM(runtime.root)).toBeNull();
    } finally {
      free.mockRestore();
      released.mockRestore();
      runtime.root.remove();
    }
  }
);

test('callback teardown retains its current bucket snapshot and removes later buckets', async () => {
  const runtime = mount();
  const order: string[] = [];
  let closing: Promise<void> | undefined;
  try {
    runtime.view.registerViewCommand(
      enter,
      () => {
        order.push('first');
        closing = runtime.close();
        return false;
      },
      4
    );
    runtime.view.registerViewCommand(
      enter,
      () => {
        order.push('snapshot');
        return false;
      },
      4
    );
    runtime.view.registerViewCommand(
      enter,
      () => {
        order.push('incorrect lower bucket');
        return true;
      },
      3
    );
    runtime.port.nativeEnter?.dispatch();
    expect(order).toEqual(['first', 'snapshot']);
    if (!closing) throw new Error('Missing actual callback close');
    await closing;
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('callback can close another actual owner without receiver reentry', async () => {
  const first = mount();
  const second = mount();
  const free = vi.spyOn(second.executor.session, 'free');
  let closing: Promise<void> | undefined;
  try {
    first.view.registerViewCommand(
      enter,
      () => {
        closing = second.close();
        expect(second.view.isMounted).toBe(false);
        expect(free).not.toHaveBeenCalled();
        return true;
      },
      4
    );
    first.port.nativeEnter?.dispatch();
    if (!closing) throw new Error('Missing second owner close');
    await closing;
    expect(free).toHaveBeenCalledTimes(1);
    expect(first.view.isMounted).toBe(true);
  } finally {
    free.mockRestore();
    await first.close();
    await second.close();
    first.root.remove();
    second.root.remove();
  }
});

test('an actual held storage barrier cannot allow registrations to reactivate a closing view', async () => {
  let storage: StorageAdapter | undefined;
  const runtime = mount(undefined, true, {
    storage: (doc, owner) => {
      storage = new StorageAdapter(doc, owner, 'fixture-user', locks);
      return storage;
    },
  });
  if (!storage) throw new Error('Missing actual storage adapter');
  const adapter = storage;
  const acquired = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const held = locks.request(snapshotWriteLock(adapter.doc), async () => {
    acquired.resolve();
    await release.promise;
  });
  await acquired.promise;
  const barrier = Promise.withResolvers<void>();
  const actualDrain = adapter.drain.bind(adapter);
  const drain = vi.spyOn(adapter, 'drain').mockImplementation(() => {
    const pending = actualDrain();
    barrier.resolve();
    return pending;
  });
  const write = adapter.execute({
    kind: 8,
    doc: adapter.doc,
    owner: adapter.owner,
    user: 'fixture-user',
    from: '',
    seq: 0n,
    through: 0n,
    before: 0n,
    retry: false,
    terminal: true,
    record: {
      seq: 0n,
      createdAt: 0n,
      user: '',
      foreign: false,
      quarantined: false,
      delivered: false,
      bytes: new Uint8Array(),
    },
    snapshot: new Uint8Array([1, 2, 3]),
    coversOwner: '',
    coversSeq: 0n,
    expected: [],
  });
  const registration = vi.spyOn(runtime.executor.session, 'registerViewEnter');
  const closing = runtime.close();
  try {
    await barrier.promise;
    expect(() =>
      runtime.view.registerViewCommand(enter, () => true, 2)
    ).toThrow('Native editor view is closing');
    expect(() => runtime.port.nativeEnter?.register(() => true, 2)).toThrow(
      'Native editor view is closing'
    );
    expect(registration).not.toHaveBeenCalled();
    release.resolve();
    await held;
    await write;
    await closing;
  } finally {
    release.resolve();
    await held;
    await closing;
    drain.mockRestore();
    registration.mockRestore();
    runtime.root.remove();
  }
});
