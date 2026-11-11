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
