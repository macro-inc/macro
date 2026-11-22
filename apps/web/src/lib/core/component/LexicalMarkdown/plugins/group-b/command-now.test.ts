// @vitest-environment jsdom
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
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  dispatchApplicationCommandNowIfSessionEdit,
  dispatchApplicationCommandSettledIfSessionEdit,
} from './command';

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

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'command-now',
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
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'command-now'
        ),
    }
  );
  return { ...runtime, root };
}

/** A real application command with no target: handled false, no change. */
const EQUATION = 'group-b.equation';
const missingEquation = () => ({ key: 0, equation: 'x' });

test('settles a real application command before returning, in the caller task', async () => {
  const runtime = mount();
  let calls = 0;
  try {
    const settled = dispatchApplicationCommandNowIfSessionEdit(
      runtime.view,
      EQUATION,
      () => {
        calls++;
        return missingEquation();
      }
    );
    // No await between the call and these reads.
    expect(settled).toEqual({ status: 'success', handled: false });
    expect(calls).toBe(1);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('matches the queued helper for the same command', async () => {
  const runtime = mount();
  try {
    const queued = await dispatchApplicationCommandSettledIfSessionEdit(
      runtime.view,
      EQUATION,
      missingEquation
    );
    const immediate = dispatchApplicationCommandNowIfSessionEdit(
      runtime.view,
      EQUATION,
      missingEquation
    );
    expect(immediate).toEqual(queued);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('lost Edit authority cancels before the payload is built', async () => {
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
    const settled = dispatchApplicationCommandNowIfSessionEdit(
      runtime.view,
      EQUATION,
      () => {
        calls++;
        return missingEquation();
      }
    );
    expect(settled).toEqual({ status: 'cancelled', reason: 'session-access' });
    expect(calls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('a busy executor throws before the payload is built', async () => {
  const runtime = mount();
  const input = vi.spyOn(runtime.executor.session, 'input');
  let calls = 0;
  let caught: unknown;
  try {
    runtime.executor.run(() => {
      try {
        dispatchApplicationCommandNowIfSessionEdit(
          runtime.view,
          EQUATION,
          () => {
            calls++;
            return missingEquation();
          }
        );
      } catch (error) {
        caught = error;
      }
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(String(caught)).toMatch(/Session executor is busy/);
    expect(calls).toBe(0);
    expect(input).not.toHaveBeenCalled();
  } finally {
    input.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('a throwing payload surfaces its own error', async () => {
  const runtime = mount();
  const failure = new Error('payload failed');
  try {
    expect(() =>
      dispatchApplicationCommandNowIfSessionEdit(runtime.view, EQUATION, () => {
        throw failure;
      })
    ).toThrow(failure);
    // The session still applies the next command.
    expect(
      dispatchApplicationCommandNowIfSessionEdit(
        runtime.view,
        EQUATION,
        missingEquation
      )
    ).toEqual({ status: 'success', handled: false });
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('an unmounted view throws before the payload is built', async () => {
  const runtime = mount();
  let calls = 0;
  try {
    const closing = runtime.close();
    expect(() =>
      dispatchApplicationCommandNowIfSessionEdit(runtime.view, EQUATION, () => {
        calls++;
        return missingEquation();
      })
    ).toThrow('Native view generation is unavailable');
    expect(calls).toBe(0);
    await closing;
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
