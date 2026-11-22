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
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      // @ts-expect-error The closed factory overload has no DOM-event argument.
      runtime.port.inputSettled(factory, event);
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

test('factory completion captures the acknowledged selection before later queued inputs', async () => {
  const runtime = mount();
  const order: string[] = [];
  let pending: ReturnType<typeof runtime.port.inputSettled> | undefined;
  let captured: ReturnType<typeof runtime.view.selection> | undefined;
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
              children: [{ type: 'text', version: 1, text: 'prepared target' }],
            },
          ],
        },
      })
    );
    const leaf = [...runtime.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!leaf) throw new Error('Missing actual text leaf');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: leaf.key, offset: 2, type: 'text' },
      focus: { key: leaf.key, offset: 8, type: 'text' },
    });
    runtime.executor.run(() => {
      pending = runtime.port.inputSettled(
        () => ({
          ...missingEquation(runtime),
          name: 'group-b.link',
          json: '{"action":"toggle","url":"https://example.com"}',
        }),
        {
          after(handled) {
            order.push(String(handled));
            captured = runtime.view.selection();
            expect(runtime.root.textContent).toBe('prepared target');
            order.push('captured');
          },
        }
      );
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'later input' }],
              },
            ],
          },
        })
      );
      runtime.executor.run(() => {
        expect(order).toEqual(['true', 'captured']);
        order.push('later');
        return runtime.executor.session.tick(
          runtime.executor.now(),
          Date.now()
        );
      });
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(await pending).toEqual({ status: 'success', handled: true });
    expect(order).toEqual(['true', 'captured', 'later']);
    expect(captured?.selection.kind).toBe('range');
    if (captured?.selection.kind !== 'range')
      throw new Error('Missing acknowledged link selection');
    expect(captured.selection.anchor.key).not.toBe(leaf.key);
    expect(captured.selection.anchor.offset).toBe(0);
    expect(captured.selection.focus.offset).toBe(6);
    expect(runtime.root.textContent).toBe('later input');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const cause of [undefined, null, { kind: 'completion failure' }]) {
  test(`factory completion retains opaque ${String(cause)} failure on its own entry`, async () => {
    const runtime = mount();
    let pending: ReturnType<typeof runtime.port.inputSettled> | undefined;
    let later: ReturnType<typeof runtime.port.inputSettled> | undefined;
    let thrown: { error: unknown } | undefined;
    let calls = 0;
    try {
      try {
        runtime.executor.run(() => {
          pending = runtime.port.inputSettled(() => missingEquation(runtime), {
            after(handled) {
              expect(handled).toBe(false);
              calls++;
              throw cause;
            },
          });
          later = runtime.port.inputSettled(() => missingEquation(runtime));
          return runtime.executor.session.tick(
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toEqual({ error: cause });
      expect(await pending).toEqual({ status: 'error', error: cause });
      expect(calls).toBe(1);
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

test('factory failure and closed admission refusal do not invoke the completion hook', async () => {
  const runtime = mount();
  let calls = 0;
  const options = {
    after() {
      calls++;
    },
  };
  let failed: ReturnType<typeof runtime.port.inputSettled> | undefined;
  let thrown: { error: unknown } | undefined;
  try {
    runtime.executor.run(() => {
      failed = runtime.port.inputSettled(() => {
        throw null;
      }, options);
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
  } catch (error) {
    thrown = { error };
  }
  try {
    expect(thrown).toEqual({ error: null });
    expect(await failed).toEqual({ status: 'error', error: null });
    await runtime.close();
    expect(() =>
      runtime.port.inputSettled(() => missingEquation(runtime), options)
    ).toThrow('closing');
    expect(calls).toBe(0);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
