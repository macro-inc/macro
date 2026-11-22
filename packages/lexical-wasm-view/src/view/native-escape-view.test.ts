/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  EditorInputMsg,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { ExecutorSettlement } from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { Telemetry } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
import { createViewCommand } from './commands';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';
import { selectionMessage } from './session-port';

const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
});
afterAll(() => {
  if (locksDescriptor)
    Object.defineProperty(navigator, 'locks', locksDescriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});
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
function mount(bindEnter = true) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'escape-view',
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
      nativeCommands: bindEnter ? native : undefined,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'escape-view'
        ),
    }
  );
  return { ...runtime, root };
}

const escapeCommand = createViewCommand(
  'Key(Escape)',
  (event): event is KeyboardEvent | null =>
    event === null || event instanceof KeyboardEvent
);
const enter = createViewCommand(
  'Key(Enter)',
  (event): event is KeyboardEvent | null =>
    event === null || event instanceof KeyboardEvent
);

test('Escape High uses the real ordered slot with its actual admitted KeyboardEvent', async () => {
  const runtime = mount();
  const events: (KeyboardEvent | null)[] = [];
  try {
    const release = runtime.view.registerViewCommand(
      escapeCommand,
      (event) => {
        events.push(event);
        event?.preventDefault();
        return true;
      },
      3
    );
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    });
    runtime.root.dispatchEvent(event);
    expect(events).toEqual([event]);
    expect(event.defaultPrevented).toBe(true);
    release();
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('Enter and Escape retain separate duplicate identities and programmatic null dispatch', async () => {
  const runtime = mount();
  let calls = 0;
  const listener = (event: KeyboardEvent | null) => {
    expect(event).toBeNull();
    calls++;
    return true;
  };
  try {
    const releaseEnter = runtime.view.registerViewCommand(enter, listener, 4);
    const releaseEscape = runtime.view.registerViewCommand(
      escapeCommand,
      listener,
      3
    );
    const duplicate = runtime.view.registerViewCommand(
      escapeCommand,
      listener,
      3
    );
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(calls).toBe(1);
    releaseEnter();
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(calls).toBe(2);
    duplicate();
    expect(runtime.port.nativeEscape?.hasListeners()).toBe(false);
    releaseEscape();
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('Escape cleanup preserves the current priority snapshot and later registration order', async () => {
  const runtime = mount();
  const order: string[] = [];
  let changed = false;
  let releaseB = () => {};
  const c = () => {
    order.push('C');
    return true;
  };
  try {
    runtime.view.registerViewCommand(
      escapeCommand,
      () => {
        order.push('A');
        if (!changed) {
          changed = true;
          releaseB();
          runtime.view.registerViewCommand(escapeCommand, c, 4);
        }
        return false;
      },
      4
    );
    releaseB = runtime.view.registerViewCommand(
      escapeCommand,
      () => {
        order.push('B');
        return true;
      },
      4
    );
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(order).toEqual(['A', 'B']);
    order.length = 0;
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(order).toEqual(['A', 'C']);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('nested programmatic Escape preserves the outer Enter KeyboardEvent frame', async () => {
  const runtime = mount();
  const seen: (KeyboardEvent | null)[] = [];
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 13,
    bubbles: true,
    cancelable: true,
  });
  try {
    runtime.view.registerViewCommand(
      escapeCommand,
      (inner) => {
        seen.push(inner);
        return true;
      },
      4
    );
    runtime.view.registerViewCommand(
      enter,
      (outer) => {
        seen.push(outer);
        expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
        seen.push(outer);
        return true;
      },
      4
    );
    runtime.root.dispatchEvent(event);
    expect(seen).toEqual([event, null, event]);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const cause of [undefined, null, { kind: 'escape callback' }]) {
  test(`Escape drains an accepted input before rethrowing ${String(cause)}`, async () => {
    const runtime = mount();
    let thrown: { error: unknown } | undefined;
    try {
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'base' }],
              },
            ],
          },
        })
      );
      const leaf = [...runtime.view.mirror.values()].find(
        (node) => node.kind === 'text'
      );
      if (!leaf) throw new Error('Missing actual text');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: leaf.key, offset: 4, type: 'text' },
        focus: { key: leaf.key, offset: 4, type: 'text' },
      });
      runtime.view.registerViewCommand(
        escapeCommand,
        () => {
          throw cause;
        },
        4
      );
      try {
        runtime.executor.run(() => {
          runtime.executor.run(() =>
            runtime.executor.session.viewCommandEscape(
              runtime.executor.now(),
              Date.now()
            )
          );
          return runtime.executor.session.input(
            SessionInputMsg.encode({
              ...emptyInput(2),
              editor: EditorInputMsg.fromEditorSetState({
                json: JSON.stringify({
                  root: {
                    type: 'root',
                    version: 1,
                    children: [
                      {
                        type: 'paragraph',
                        version: 1,
                        children: [
                          { type: 'text', version: 1, text: 'accepted' },
                        ],
                      },
                    ],
                  },
                }),
              }),
            }),
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toEqual({ error: cause });
      expect(runtime.root.textContent).toBe('accepted');
      expect(runtime.root.querySelector('a')).toBeNull();
      expect(runtime.port.nativeEscape?.takeFailure()).toBeUndefined();
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('Escape blocks ordinary receiver reentry before bindgen and rejects busy admission', async () => {
  const runtime = mount();
  let calls = 0;
  try {
    runtime.view.registerViewCommand(
      escapeCommand,
      () => {
        calls++;
        expect(() => runtime.executor.session.effectiveAccess()).toThrow(
          'Native session receiver call'
        );
        return true;
      },
      4
    );
    runtime.executor.run(() => {
      expect(() => runtime.port.nativeEscape?.dispatch()).toThrow('busy');
      expect(calls).toBe(0);
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(calls).toBe(1);
    expect(runtime.executor.session.effectiveAccess()).toBe(2);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('Escape can close its own view while preserving the original failure and terminal cleanup', async () => {
  const runtime = mount();
  const cause = { kind: 'escape close' };
  let closing: Promise<void> | undefined;
  let thrown: { error: unknown } | undefined;
  runtime.view.registerViewCommand(
    escapeCommand,
    () => {
      closing = runtime.close();
      expect(runtime.view.isMounted).toBe(false);
      throw cause;
    },
    4
  );
  try {
    try {
      runtime.port.nativeEscape?.dispatch();
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: cause });
    if (!closing) throw new Error('Escape did not request close');
    await closing;
    expect(runtime.view.isMounted).toBe(false);
    expect(() => runtime.executor.session.effectiveAccess()).toThrow();
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('Escape dispatches a real application through its issued transaction scope', async () => {
  const runtime = mount();
  try {
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'base' }],
            },
          ],
        },
      })
    );
    const leaf = [...runtime.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!leaf) throw new Error('Missing actual text');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: leaf.key, offset: 4, type: 'text' },
      focus: { key: leaf.key, offset: 4, type: 'text' },
    });
    runtime.view.registerViewCommand(
      escapeCommand,
      () => {
        const port = runtime.port.nativeEscape;
        const scope = port?.scope();
        if (!port || !scope) throw new Error('Missing actual Escape scope');
        return port.dispatchScoped(
          EditorInputMsg.fromEditorApplication({
            name: 'group-b.link',
            json: '{"action":"insert","url":"https://example.com","label":"!"}',
            generation: scope.generation,
            selection: selectionMessage({ kind: 'keep' }),
            keyboard: false,
            key: '',
            mods: 0,
            code: 0,
          })
        );
      },
      4
    );
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(runtime.root.textContent).toBe('base!');
    expect(runtime.root.querySelector('a')?.textContent).toBe('!');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('another editor callback releases a live owner listener once before its next registration', async () => {
  const first = mount();
  const second = mount();
  const calls: string[] = [];
  const command = createViewCommand(
    'Key(Escape)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  const original = () => {
    calls.push('original');
    return true;
  };
  const release = first.view.registerViewCommand(command, original, 3);
  const duplicate = first.view.registerViewCommand(command, original, 3);
  const unregister = vi.spyOn(first.executor.session, 'unregisterViewEscape');
  first.view.registerViewCommand(
    command,
    () => {
      calls.push('later');
      return false;
    },
    3
  );
  second.view.registerViewCommand(
    command,
    () => {
      release();
      release();
      duplicate();
      return true;
    },
    3
  );
  try {
    expect(second.port.nativeEscape?.dispatch()).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(1);
    first.view.registerViewCommand(command, original, 3);
    expect(first.port.nativeEscape?.dispatch()).toBe(true);
    expect(calls).toEqual(['later', 'original']);
    calls.length = 0;
    release();
    expect(first.port.nativeEscape?.dispatch()).toBe(false);
    expect(calls).toEqual(['later']);
    expect(unregister).toHaveBeenCalledTimes(2);
  } finally {
    unregister.mockRestore();
    await second.close();
    await first.close();
    second.root.remove();
    first.root.remove();
  }
});

test('owner close before deferred listener removal never calls a freed receiver', async () => {
  const first = mount();
  const second = mount();
  const command = createViewCommand(
    'Key(Escape)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  const release = first.view.registerViewCommand(command, () => true, 3);
  let closing: Promise<void> | undefined;
  second.view.registerViewCommand(
    command,
    () => {
      closing = first.close();
      release();
      release();
      return true;
    },
    3
  );
  try {
    expect(second.port.nativeEscape?.dispatch()).toBe(true);
    if (!closing)
      throw new Error('Actual callback did not close its other owner');
    await closing;
    expect(() => first.executor.session.effectiveAccess()).toThrow();
    expect(() => release()).not.toThrow();
    second.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                { type: 'text', version: 1, text: 'Second owner still live' },
              ],
            },
          ],
        },
      })
    );
    expect(second.root.textContent).toBe('Second owner still live');
  } finally {
    await second.close();
    await first.close();
    first.root.remove();
    second.root.remove();
  }
});

test('deferred cross-owner cleanup failure stays secondary to the actual callback primary', async () => {
  const first = mount();
  const second = mount();
  const primary = { kind: 'actual second-owner callback failure' };
  const cleanup = undefined;
  const command = createViewCommand(
    'Key(Escape)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  let firstCalls = 0;
  const release = first.view.registerViewCommand(
    command,
    () => {
      firstCalls++;
      return true;
    },
    3
  );
  const unregister = vi
    .spyOn(first.executor.session, 'unregisterViewEscape')
    .mockImplementationOnce(() => {
      throw cleanup;
    });
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  second.view.registerViewCommand(
    command,
    () => {
      release();
      throw primary;
    },
    3
  );
  try {
    let thrown: { error: unknown } | undefined;
    try {
      second.port.nativeEscape?.dispatch();
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: primary });
    expect(report.mock.calls.some(([error]) => error === cleanup)).toBe(true);
    unregister.mockRestore();
    expect(first.port.nativeEscape?.dispatch()).toBe(true);
    expect(firstCalls).toBe(1);
  } finally {
    unregister.mockRestore();
    report.mockRestore();
    await second.close();
    await first.close();
    first.root.remove();
    second.root.remove();
  }
});

test('idle cleanup invalidates a deferred request before the same identity is readded', async () => {
  const first = mount();
  const second = mount();
  const calls: string[] = [];
  const original = () => {
    calls.push('original');
    return true;
  };
  const release = first.view.registerViewCommand(escapeCommand, original, 3);
  first.view.registerViewCommand(
    escapeCommand,
    () => {
      calls.push('later');
      return false;
    },
    3
  );
  second.view.registerViewCommand(
    escapeCommand,
    () => {
      release();
      return true;
    },
    3
  );
  try {
    // Keep the actual returned flags unconsumed to exercise the real post-return gap.
    const flags = second.executor.session.viewCommandEscape(
      second.executor.now(),
      Date.now()
    );
    release();
    first.view.registerViewCommand(escapeCommand, original, 3);
    second.executor.runSync(() => flags);
    expect(first.port.nativeEscape?.dispatch()).toBe(true);
    expect(calls).toEqual(['later', 'original']);
  } finally {
    await second.close();
    await first.close();
    first.root.remove();
    second.root.remove();
  }
});

test('failed owner unregistration cannot make deferred cleanup enter its freed session', async () => {
  const first = mount();
  const second = mount();
  const cause = { kind: 'injected terminal unregister failure' };
  const release = first.view.registerViewCommand(escapeCommand, () => true, 3);
  const unregister = vi
    .spyOn(first.executor.session, 'unregisterViewEscape')
    .mockImplementationOnce(() => {
      throw cause;
    })
    .mockImplementationOnce(() => {
      throw cause;
    });
  second.view.registerViewCommand(
    escapeCommand,
    () => {
      release();
      return true;
    },
    3
  );
  try {
    const closing = first.close().then(
      () => undefined,
      (error) => ({ error })
    );
    // Queue removal after Stop drained, then let the real terminal close finish.
    const flags = second.executor.session.viewCommandEscape(
      second.executor.now(),
      Date.now()
    );
    expect(await closing).toEqual({ error: cause });
    expect(() => first.executor.session.effectiveAccess()).toThrow();
    // Consume the actual flags once, only after the other receiver was freed.
    expect(() => second.executor.runSync(() => flags)).not.toThrow();
    expect(unregister).toHaveBeenCalledTimes(2);
  } finally {
    unregister.mockRestore();
    await second.close();
    await first.close().catch((error) => {
      expect(error).toBe(cause);
    });
    first.root.remove();
    second.root.remove();
  }
});

test('terminal owner failure makes queued removal inert before close finishes', async () => {
  const first = mount();
  const second = mount();
  const cause = { kind: 'injected terminal unregister failure' };
  const release = first.view.registerViewCommand(escapeCommand, () => true, 3);
  const unregister = vi
    .spyOn(first.executor.session, 'unregisterViewEscape')
    .mockImplementationOnce(() => {
      throw cause;
    })
    .mockImplementationOnce(() => {
      throw cause;
    });
  let closing: Promise<{ error: unknown } | undefined> | undefined;
  second.view.registerViewCommand(
    escapeCommand,
    () => {
      closing = first.close().then(
        () => undefined,
        (error) => ({ error })
      );
      release();
      return true;
    },
    3
  );
  try {
    expect(second.port.nativeEscape?.dispatch()).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(2);
    if (!closing)
      throw new Error('Actual callback did not initiate terminal close');
    expect(await closing).toEqual({ error: cause });
    expect(() => first.executor.session.effectiveAccess()).toThrow();
  } finally {
    unregister.mockRestore();
    await second.close();
    await first.close().catch((error) => {
      expect(error).toBe(cause);
    });
    first.root.remove();
    second.root.remove();
  }
});

test('per-key disposal keeps the live owner reusable and preserves stale cleanup semantics', async () => {
  const runtime = mount();
  let calls = 0;
  const listener = () => {
    calls++;
    return true;
  };
  const stale = runtime.view.registerViewCommand(escapeCommand, listener, 3);
  try {
    runtime.port.nativeEscape?.dispose();
    runtime.view.registerViewCommand(escapeCommand, listener, 3);
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(calls).toBe(1);
    stale();
    expect(runtime.port.nativeEscape?.dispatch()).toBe(false);
    expect(calls).toBe(1);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('a deferred cleanup error belongs to its draining entry and leaves the other owner live', async () => {
  const first = mount();
  const second = mount();
  const cleanup = undefined;
  const release = first.view.registerViewCommand(escapeCommand, () => true, 3);
  const unregister = vi
    .spyOn(first.executor.session, 'unregisterViewEscape')
    .mockImplementationOnce(() => {
      throw cleanup;
    });
  second.view.registerViewCommand(
    escapeCommand,
    () => {
      release();
      return true;
    },
    3
  );
  try {
    const before = second.view.query.serializedState();
    let thrown: { error: unknown } | undefined;
    let result: ExecutorSettlement | undefined;
    try {
      second.executor.runSettled(
        () =>
          second.executor.session.viewCommandEscape(
            second.executor.now(),
            Date.now()
          ),
        (value) => {
          result = value;
        }
      );
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: cleanup });
    expect(result).toEqual({ status: 'error', error: cleanup });
    expect(second.view.query.serializedState()).toBe(before);
    expect(second.executor.session.takeOutput()).toHaveLength(0);
    unregister.mockRestore();
    expect(first.port.nativeEscape?.dispatch()).toBe(true);
  } finally {
    unregister.mockRestore();
    await second.close();
    await first.close();
    first.root.remove();
    second.root.remove();
  }
});
