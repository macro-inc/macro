import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createNativeHorizontalRuleViews } from '../../decorator-host/native-horizontal-rule';
import { createNativeSelectionDecoratorContext } from '../../decorator-host/native-selection-host';
import { registerNativeBlockNavigation } from './native';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const previousScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);
const rects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
);
afterEach(() => {
  vi.restoreAllMocks();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
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
  if (previousScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      previousScroll
    );
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

function mounted() {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const selection = createNativeSelectionDecoratorContext({});
  const registry = registerMacroElementViews(createBuiltinRegistry());
  registerMacroDecoratorViews(
    registry,
    createNativeHorizontalRuleViews(selection.bindView)
  );
  const runtime = mountLocalSessionView(
    root,
    registry,
    {
      namespace: 'block-navigation-controls',
      theme: {},
      editable: true,
      preset: 'rich',
      onError: (error) => errors.push(error),
    },
    {
      nativeCommands: native,
      viewEngine: 1,
      viewOs: 0,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'block-navigation-controls'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        $: { documentMetadata: { version: 11 } },
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Before' }] },
          { type: 'horizontalrule' },
          { type: 'paragraph', children: [{ type: 'text', text: 'end' }] },
        ],
      },
    })
  );
  const unregister = registerNativeBlockNavigation(runtime.view);
  const p = root.querySelector('p');
  if (!p) throw new Error('Missing actual paragraph');
  root.focus();
  const point = runtime.port.query({
    kind: 2,
    key: 0,
    text: 'Before',
    flags: 0,
  }).points[0];
  if (!point) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: point.key, type: 'text', offset: 6 },
    focus: { key: point.key, type: 'text', offset: 6 },
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () =>
      Object.assign([new DOMRect(0, 0, 0, 20)], {
        item: (index: number) =>
          index === 0 ? new DOMRect(0, 0, 0, 20) : null,
      }),
  });
  return {
    ...runtime,
    root,
    p,
    errors,
    async dispose() {
      unregister();
      await runtime.close();
      selection.dispose();
      root.remove();
    },
  };
}

test('actual scoped native plans consume fresh rectangles then let the second arrow leave the rule', async () => {
  const fixture = mounted();
  vi.spyOn(fixture.p, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 200, 20)
  );
  try {
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.view.selection().selection.kind).toBe('node');
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
        cancelable: true,
      })
    );
    const selected = fixture.view.selection().selection;
    expect(selected.kind).toBe('range');
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.dispose();
  }
});

test('a throwing measurement cancels its actual plan and retains the original opaque cause', async () => {
  const fixture = mounted();
  const cause = { opaque: Symbol('measurement') };
  vi.spyOn(fixture.p, 'getBoundingClientRect').mockImplementation(() => {
    throw cause;
  });
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      keyCode: 40,
    });
    let thrown: { error: unknown } | undefined;
    try {
      fixture.port.keyDown(40, 0, 0, 'ArrowDown', { kind: 'keep' }, event);
    } catch (error) {
      thrown = { error };
    }
    expect(thrown?.error).toBe(cause);
    expect(fixture.errors).toContain(cause);
    expect(fixture.view.selection().selection.kind).toBe('range');
  } finally {
    await fixture.dispose();
  }
});

test('teardown during measurement cancels without selecting the issued target', async () => {
  const fixture = mounted();
  vi.spyOn(fixture.p, 'getBoundingClientRect').mockImplementation(() => {
    fixture.view.beginTeardown();
    return new DOMRect(0, 0, 200, 20);
  });
  try {
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.view.selection().selection.kind).not.toBe('node');
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.dispose();
  }
});
