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
      namespace: 'input-factory',
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
          'input-factory'
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

for (const canComment of [false, true]) {
  test(`queued current authority refusal skips the factory and application (${canComment})`, async () => {
    const runtime = mount();
    const session = runtime.executor.session;
    const input = vi.spyOn(session, 'input');
    const readAccess = session.effectiveAccess.bind(session);
    const authority = vi
      .spyOn(session, 'effectiveAccess')
      .mockImplementation(() => {
        outputBefore = output.mock.calls.length;
        return readAccess();
      });
    const output = vi.spyOn(session, 'takeOutput');
    let pending:
      | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
      | undefined;
    let factoryCalls = 0;
    let outputBefore = 0;
    try {
      runtime.executor.run(() => {
        pending = runtime.port.inputSettledIfSessionEdit(() => {
          factoryCalls++;
          return missingEquation(runtime);
        });
        return session.authorization(
          true,
          false,
          canComment,
          runtime.executor.now(),
          Date.now()
        );
      });
      expect(await pending).toEqual({
        status: 'cancelled',
        reason: 'session-access',
      });
      expect(authority).toHaveBeenCalledTimes(1);
      expect(input).not.toHaveBeenCalled();
      expect(output.mock.calls.length).toBe(outputBefore);
      expect(factoryCalls).toBe(0);
    } finally {
      input.mockRestore();
      authority.mockRestore();
      output.mockRestore();
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('authority regrant admits the next real application and UI readonly does not cancel it', async () => {
  const runtime = mount();
  const session = runtime.executor.session;
  const input = vi.spyOn(session, 'input');
  const authority = vi.spyOn(session, 'effectiveAccess');
  let denied:
    | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
    | undefined;
  let allowed:
    | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
    | undefined;
  let deniedCalls = 0;
  let allowedCalls = 0;
  try {
    runtime.view.setEditable(false);
    runtime.executor.run(() => {
      denied = runtime.port.inputSettledIfSessionEdit(() => {
        deniedCalls++;
        return missingEquation(runtime);
      });
      runtime.executor.run(() =>
        session.authorization(
          true,
          true,
          true,
          runtime.executor.now(),
          Date.now()
        )
      );
      allowed = runtime.port.inputSettledIfSessionEdit(() => {
        allowedCalls++;
        return missingEquation(runtime);
      });
      return session.authorization(
        true,
        false,
        false,
        runtime.executor.now(),
        Date.now()
      );
    });
    expect(await denied).toEqual({
      status: 'cancelled',
      reason: 'session-access',
    });
    expect(await allowed).toEqual({ status: 'success', handled: false });
    expect(deniedCalls).toBe(0);
    expect(allowedCalls).toBe(1);
    expect(authority).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenCalledTimes(1);
    expect(runtime.view.isEditable).toBe(false);
    // Ordinary programmatic updates retain their existing UI-readonly behavior.
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                { type: 'text', version: 1, text: 'programmatic readonly' },
              ],
            },
          ],
        },
      })
    );
    expect(runtime.root.textContent).toBe('programmatic readonly');
  } finally {
    input.mockRestore();
    authority.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

for (const cause of [undefined, null, { kind: 'authority failure' }]) {
  test(`authority getter preserves own opaque ${String(cause)} error and remaining FIFO`, async () => {
    const runtime = mount();
    const authority = vi
      .spyOn(runtime.executor.session, 'effectiveAccess')
      .mockImplementationOnce(() => {
        throw cause;
      });
    let failed:
      | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
      | undefined;
    let later:
      | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
      | undefined;
    let caught: { error: unknown } | undefined;
    let calls = 0;
    try {
      try {
        runtime.executor.run(() => {
          failed = runtime.port.inputSettledIfSessionEdit(() => {
            calls++;
            return missingEquation(runtime);
          });
          later = runtime.port.inputSettledIfSessionEdit(() => {
            calls++;
            return missingEquation(runtime);
          });
          return runtime.executor.session.tick(
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        caught = { error };
      }
      expect(caught).toEqual({ error: cause });
      expect(await failed).toEqual({ status: 'error', error: cause });
      expect(calls).toBe(0);
      runtime.executor.run(() =>
        runtime.executor.session.tick(runtime.executor.now(), Date.now())
      );
      expect(await later).toEqual({ status: 'success', handled: false });
      expect(calls).toBe(1);
    } finally {
      authority.mockRestore();
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('module callbacks reject synchronously and unbound closing ports cancel before authority or factory', async () => {
  const runtime = mount();
  const other = mount(false);
  const authority = vi.spyOn(other.executor.session, 'effectiveAccess');
  let calls = 0;
  const factory = () => {
    calls++;
    return missingEquation(other);
  };
  const Enter = createViewCommand(
    'Key(Enter)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  const release = runtime.view.registerViewCommand(
    Enter,
    () => {
      expect(() => other.port.inputSettledIfSessionEdit(factory)).toThrow();
      return true;
    },
    2
  );
  try {
    other.executor.run(() => {
      expect(runtime.port.nativeEnter?.dispatch()).toBe(true);
      return other.executor.session.tick(other.executor.now(), Date.now());
    });
    expect(authority).not.toHaveBeenCalled();
    expect(calls).toBe(0);
    const closing = other.close();
    expect(await other.port.inputSettledIfSessionEdit(factory)).toEqual({
      status: 'cancelled',
      reason: 'closing',
    });
    await closing;
    expect(authority).not.toHaveBeenCalled();
    expect(calls).toBe(0);
  } finally {
    release();
    authority.mockRestore();
    await runtime.close();
    await other.close();
    runtime.root.remove();
    other.root.remove();
  }
});

test('an accepted conditional entry runs before queued close while later closing admission is refused', async () => {
  const runtime = mount();
  let pending:
    | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
    | undefined;
  let closing: Promise<void> | undefined;
  let calls = 0;
  try {
    runtime.executor.run(() => {
      pending = runtime.port.inputSettledIfSessionEdit(() => {
        calls++;
        return missingEquation(runtime);
      });
      closing = runtime.close();
      expect(() =>
        runtime.port.inputSettledIfSessionEdit(() => {
          throw new Error('Closing factory must not run');
        })
      ).toThrow();
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(await pending).toEqual({ status: 'success', handled: false });
    expect(calls).toBe(1);
    await closing;
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
