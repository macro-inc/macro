/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
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

type NowPort = {
  inputNowIfSessionEdit(
    factory: () => ReturnType<typeof missingEquation>,
    options?: { readonly admit: () => boolean }
  ): unknown;
};
/** The synchronous seam under test; absent until the extraction lands. */
function now(runtime: ReturnType<typeof mount>): NowPort {
  return runtime.port as unknown as NowPort;
}

test('settles a real application before returning, in the caller task', async () => {
  const runtime = mount();
  let calls = 0;
  try {
    const settled = now(runtime).inputNowIfSessionEdit(() => {
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
    const immediate = now(runtime).inputNowIfSessionEdit(() =>
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
        now(runtime).inputNowIfSessionEdit(() => {
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
    const settled = now(runtime).inputNowIfSessionEdit(() => {
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
    const settled = now(runtime).inputNowIfSessionEdit(
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
    const settled = now(runtime).inputNowIfSessionEdit(factory);
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
    expect(() => now(runtime).inputNowIfSessionEdit(factory)).toThrow(
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
        settled = now(runtime).inputNowIfSessionEdit(() => {
          throw cause;
        });
      } catch (error) {
        caught = { error };
      }
      // Same contract as the queued method: the drain rethrows the original value.
      expect(caught).toEqual({ error: cause });
      expect(settled).toBeUndefined();
      const later = now(runtime).inputNowIfSessionEdit(() =>
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
      now(runtime).inputNowIfSessionEdit(() => missingEquation(runtime), {
        admit: 1 as unknown as () => boolean,
      })
    ).toThrow(new TypeError('Entry admission requires a callback'));
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
