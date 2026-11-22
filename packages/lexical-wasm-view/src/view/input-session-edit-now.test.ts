/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
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
      namespace: 'input-now',
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
          'input-now'
        ),
    }
  );
  return { ...runtime, root };
}
function missingEquation(runtime: ReturnType<typeof mount>) {
  const generation = runtime.view.mirror.keyGeneration;
  if (generation === null) throw new Error('Missing actual view generation');
  return {
    name: 'group-b.equation',
    json: JSON.stringify({ key: 0, equation: 'x' }),
    generation,
    selection: selectionMessage({ kind: 'keep' }),
  };
}

test('settles a real application before returning, in the caller task', async () => {
  const runtime = mount();
  let calls = 0;
  try {
    const settled = runtime.port.inputNowIfSessionEdit(() => {
      calls++;
      return missingEquation(runtime);
    });
    // No await between the call and these reads.
    expect(settled).toEqual({ status: 'success', handled: false });
    expect(calls).toBe(1);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('matches the queued method for the same application', async () => {
  const runtime = mount();
  try {
    const queued = await runtime.port.inputSettledIfSessionEdit(() =>
      missingEquation(runtime)
    );
    const immediate = runtime.port.inputNowIfSessionEdit(() =>
      missingEquation(runtime)
    );
    expect(immediate).toEqual(queued);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('a busy executor throws before the factory runs and queues nothing', async () => {
  const runtime = mount();
  const input = vi.spyOn(runtime.executor.session, 'input');
  let calls = 0;
  let caught: unknown;
  try {
    runtime.executor.run(() => {
      try {
        runtime.port.inputNowIfSessionEdit(() => {
          calls++;
          return missingEquation(runtime);
        });
      } catch (error) {
        caught = error;
      }
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/busy/);
    expect(calls).toBe(0);
    expect(input).not.toHaveBeenCalled();
  } finally {
    input.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('a reentrant call throws busy and the outer call rethrows that same error', async () => {
  const runtime = mount();
  let inner: unknown;
  let outer: unknown;
  let innerCalls = 0;
  try {
    try {
      runtime.port.inputNowIfSessionEdit(() => {
        try {
          runtime.port.inputNowIfSessionEdit(() => {
            innerCalls++;
            return missingEquation(runtime);
          });
        } catch (error) {
          inner = error;
        }
        throw inner;
      });
    } catch (error) {
      outer = error;
    }
    expect(inner).toBeInstanceOf(Error);
    expect(String(inner)).toMatch(/busy/);
    expect(outer).toBe(inner);
    expect(innerCalls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('queued work ahead throws busy before the factory and queues nothing', async () => {
  const runtime = mount();
  const { executor } = runtime;
  const tick = () => executor.session.tick(executor.now(), Date.now());
  const first = new Error('first entry failed');
  let calls = 0;
  try {
    // A failed drain leaves later entries queued with the executor idle.
    expect(() =>
      executor.run(() => {
        executor.run(tick);
        throw first;
      })
    ).toThrow(first);
    expect(() =>
      runtime.port.inputNowIfSessionEdit(() => {
        calls++;
        return missingEquation(runtime);
      })
    ).toThrow('Session executor is busy');
    executor.run(tick);
    expect(calls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('work queued behind an applied entry rethrows its own error from the call', async () => {
  const runtime = mount();
  const { executor } = runtime;
  const later = new Error('queued behind');
  let calls = 0;
  let caught: unknown;
  try {
    try {
      runtime.port.inputNowIfSessionEdit(() => {
        calls++;
        executor.run(() => {
          throw later;
        });
        return missingEquation(runtime);
      });
    } catch (error) {
      caught = error;
    }
    // The entry ran; the throw is the later work's, not "did not settle".
    expect(calls).toBe(1);
    expect(caught).toBe(later);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('lost Edit authority cancels before the factory', async () => {
  const runtime = mount();
  const session = runtime.executor.session;
  let calls = 0;
  try {
    runtime.executor.run(() =>
      session.authorization(
        true,
        false,
        false,
        runtime.executor.now(),
        Date.now()
      )
    );
    const settled = runtime.port.inputNowIfSessionEdit(() => {
      calls++;
      return missingEquation(runtime);
    });
    expect(settled).toEqual({ status: 'cancelled', reason: 'session-access' });
    expect(calls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('entry admission false cancels before the factory', async () => {
  const runtime = mount();
  let calls = 0;
  try {
    const settled = runtime.port.inputNowIfSessionEdit(
      () => {
        calls++;
        return missingEquation(runtime);
      },
      { admit: () => false }
    );
    expect(settled).toEqual({ status: 'cancelled', reason: 'entry-admission' });
    expect(calls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const bound of [true, false]) {
  test(`a ${bound ? 'bound' : 'unbound'} view is unmounted as soon as close starts`, async () => {
    // The AI-edit host classifies retirement from this owned state before
    // entry, never from a caught admission throw.
    const runtime = mount(bound);
    try {
      expect(runtime.view.isMounted).toBe(true);
      const closing = runtime.close();
      expect(runtime.view.isMounted).toBe(false);
      await closing;
      expect(runtime.view.isMounted).toBe(false);
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('a closing unbound session cancels before the factory, like the queued method', async () => {
  const runtime = mount(false);
  let calls = 0;
  const factory = () => {
    calls++;
    return missingEquation(runtime);
  };
  try {
    const closing = runtime.close();
    const queued = await runtime.port.inputSettledIfSessionEdit(factory);
    const settled = runtime.port.inputNowIfSessionEdit(factory);
    expect(queued).toEqual({ status: 'cancelled', reason: 'closing' });
    expect(settled).toEqual(queued);
    expect(calls).toBe(0);
    await closing;
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('a closing view with native Enter refuses admission, like the queued method', async () => {
  const runtime = mount();
  let calls = 0;
  const factory = () => {
    calls++;
    return missingEquation(runtime);
  };
  try {
    const closing = runtime.close();
    expect(() => runtime.port.inputSettledIfSessionEdit(factory)).toThrow(
      'Native editor view is closing'
    );
    expect(() => runtime.port.inputNowIfSessionEdit(factory)).toThrow(
      'Native editor view is closing'
    );
    expect(calls).toBe(0);
    await closing;
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const cause of [undefined, null, { kind: 'factory failure' }]) {
  test(`a factory throwing ${String(cause)} settles as its own opaque error`, async () => {
    const runtime = mount();
    let caught: { error: unknown } | undefined;
    let settled: unknown;
    try {
      try {
        settled = runtime.port.inputNowIfSessionEdit(() => {
          throw cause;
        });
      } catch (error) {
        caught = { error };
      }
      // Same contract as the queued method: the drain rethrows the original value.
      expect(caught).toEqual({ error: cause });
      expect(settled).toBeUndefined();
      const later = runtime.port.inputNowIfSessionEdit(() =>
        missingEquation(runtime)
      );
      expect(later).toEqual({ status: 'success', handled: false });
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('rejects a non-function admission option before any work', async () => {
  const runtime = mount();
  try {
    expect(() =>
      runtime.port.inputNowIfSessionEdit(() => missingEquation(runtime), {
        admit: 1 as unknown as () => boolean,
      })
    ).toThrow(new TypeError('Entry admission requires a callback'));
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
