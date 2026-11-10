/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { afterAll, beforeAll, expect, test } from 'vitest';
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

test('materializes once after preceding queued input and settles a real native unhandled action', async () => {
  const runtime = mount();
  let pending: ReturnType<typeof runtime.port.inputSettled> | undefined;
  let calls = 0;
  let observed = 0;
  try {
    runtime.executor.run(() => {
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'queued target' }],
              },
            ],
          },
        })
      );
      pending = runtime.port.inputSettled(() => {
        calls++;
        observed = runtime.port.query({
          kind: 3,
          key: 0,
          flags: 0,
          text: '',
        }).count;
        return missingEquation(runtime);
      });
      expect(calls).toBe(0);
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(await pending).toEqual({ status: 'success', handled: false });
    expect(calls).toBe(1);
    expect(observed).toBe(2);
    expect(runtime.root.textContent).toBe('queued target');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const cause of [undefined, null, { kind: 'factory failure' }]) {
  test(`queued factory keeps its opaque ${String(cause)} failure and accepted FIFO`, async () => {
    const runtime = mount();
    let pending: ReturnType<typeof runtime.port.inputSettled> | undefined;
    let later: ReturnType<typeof runtime.port.inputSettled> | undefined;
    let original: { error: unknown } | undefined;
    try {
      try {
        runtime.executor.run(() => {
          pending = runtime.port.inputSettled(() => {
            throw cause;
          });
          later = runtime.port.inputSettled(() => missingEquation(runtime));
          return runtime.executor.session.tick(
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        original = { error };
      }
      expect(original).toEqual({ error: cause });
      expect(await pending).toEqual({ status: 'error', error: cause });
      runtime.executor.run(() =>
        runtime.executor.session.tick(runtime.executor.now(), Date.now())
      );
      expect(await later).toEqual({ status: 'success', handled: false });
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('rejects an active native callback and closed port before invoking or queuing the factory', async () => {
  const runtime = mount();
  let calls = 0;
  const factory = () => {
    calls++;
    return missingEquation(runtime);
  };
  const Enter = createViewCommand(
    'Key(Enter)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  const release = runtime.view.registerViewCommand(
    Enter,
    () => {
      expect(() => runtime.port.inputSettled(factory)).toThrow();
      return true;
    },
    2
  );
  try {
    const enter = runtime.port.nativeEnter;
    if (!enter) throw new Error('Missing real ordinary Enter capability');
    expect(enter.dispatch()).toBe(true);
    expect(calls).toBe(0);
    release();
    await runtime.close();
    expect(() => runtime.port.inputSettled(factory)).toThrow('closing');
    expect(calls).toBe(0);
  } finally {
    release();
    await runtime.close();
    runtime.root.remove();
  }
});

test('rejects deferred DOM events before queue admission or factory execution', async () => {
  const runtime = mount();
  let calls = 0;
  const factory = () => {
    calls++;
    return missingEquation(runtime);
  };
  try {
    expect(() => {
      runtime.port.inputSettled(
        // @ts-expect-error The closed factory overload has no DOM-event argument.
        factory,
        new KeyboardEvent('keydown', { key: 'Enter' })
      );
    }).toThrow('Deferred application inputs cannot carry DOM events');
    expect(calls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('an opted-out busy executor rejects other-owner factories before the module tuple pops', async () => {
  const first = mount();
  const other = mount(false);
  let calls = 0;
  const Enter = createViewCommand(
    'Key(Enter)',
    (value): value is KeyboardEvent | null =>
      value === null || value instanceof KeyboardEvent
  );
  const release = first.view.registerViewCommand(
    Enter,
    () => {
      expect(() =>
        other.port.inputSettled(() => {
          calls++;
          return missingEquation(other);
        })
      ).toThrow();
      return true;
    },
    2
  );
  try {
    other.executor.run(() => {
      const enter = first.port.nativeEnter;
      if (!enter) throw new Error('Missing actual Enter slot');
      expect(enter.dispatch()).toBe(true);
      return other.executor.session.tick(other.executor.now(), Date.now());
    });
    expect(calls).toBe(0);
  } finally {
    release();
    await first.close();
    await other.close();
    first.root.remove();
    other.root.remove();
  }
});

test('wraps only closed programmatic fields and preserves the actual handled result', async () => {
  const runtime = mount();
  let keyboardReads = 0;
  try {
    const application = {
      ...missingEquation(runtime),
      name: 'group-b.user-display-names',
      json: '{"names":{}}',
    };
    Object.defineProperty(application, 'keyboard', {
      get() {
        keyboardReads++;
        throw new Error('Forbidden deferred event metadata');
      },
    });
    const result = await runtime.port.inputSettled(() => application);
    expect(result).toEqual({ status: 'success', handled: true });
    expect(keyboardReads).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
