import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import { createMenuOperations } from '../../shared/inlineMenu';
import { registerNativeMentionSearch } from './native-mention-search';

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
      namespace: 'native-mention-search',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
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
          'native-mention-search'
        ),
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
            children: [{ type: 'text', version: 1, text: 'body' }],
          },
        ],
      },
    })
  );
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 0, type: 'text' },
    focus: { key: text.key, offset: 0, type: 'text' },
  });
  runtime.view.focus();
  return { ...runtime, root };
}
function trigger(runtime: ReturnType<typeof mount>) {
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
    kind: 'mentions',
  });
  runtime.port.command(CommandCode.InsertText, 0, 0, 'person');
  const search = [...runtime.view.mirror.values()].find(
    (node) => node.type === 'inline-search'
  );
  if (!search) throw new Error('Missing actual native inline search');
  return search;
}

test('initial snapshot then equal actual callbacks retain locally owned openness without polling', async () => {
  const runtime = mount();
  const search = trigger(runtime);
  const menu = createMenuOperations();
  const query = vi.spyOn(runtime.port, 'query');
  const terms = vi.spyOn(menu, 'setSearchTerm');
  const callbacks: string[] = [];
  const releaseEvents = runtime.view.onPluginEvent(
    'group-a.search-change',
    (event) => {
      if (
        event &&
        typeof event === 'object' &&
        'kind' in event &&
        event.kind === 'mentions'
      )
        callbacks.push(JSON.stringify(event));
    }
  );
  const dispose = registerNativeMentionSearch(runtime.view, menu);
  try {
    expect(menu.isOpen()).toBe(true);
    expect(menu.searchTerm()).toBe('person');
    expect(query).toHaveBeenCalledTimes(1);
    terms.mockClear();
    menu.setIsOpen(false);
    for (let i = 0; i < 2; i++) {
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: search.key, offset: 0, type: 'text' },
        focus: { key: search.key, offset: search.text.length, type: 'text' },
      });
      runtime.port.command(CommandCode.FormatText, 0);
      expect(menu.isOpen()).toBe(false);
      expect(menu.searchTerm()).toBe('person');
    }
    expect(terms).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(2);
    expect(callbacks[0]).toBe(callbacks[1]);
    expect(query).toHaveBeenCalledTimes(1);
    menu.setSearchTerm('UI-only reset');
    expect(menu.searchTerm()).toBe('UI-only reset');
    expect(query).toHaveBeenCalledTimes(1);
  } finally {
    dispose();
    releaseEvents();
    query.mockRestore();
    terms.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('actual CRITICAL native Enter consumes while open and yields to real splitting when closed', async () => {
  const runtime = mount();
  const menu = createMenuOperations();
  const dispose = registerNativeMentionSearch(runtime.view, menu);
  try {
    trigger(runtime);
    expect(menu.isOpen()).toBe(true);
    const enter = runtime.port.nativeEnter;
    if (!enter) throw new Error('Missing actual native Enter binding');
    const before = runtime.executor.session.serializedState();
    expect(enter.dispatch()).toBe(true);
    expect(runtime.executor.session.serializedState()).toBe(before);
    menu.setIsOpen(false);
    enter.dispatch();
    expect(runtime.view.mirror.node(0)?.children).toHaveLength(2);
  } finally {
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('shared root trigger deduplicates keydown/beforeinput and disposes actual bindings', async () => {
  const runtime = mount();
  const menu = createMenuOperations();
  const dispose = registerNativeMentionSearch(runtime.view, menu);
  try {
    const keyboard = new KeyboardEvent('keydown', {
      key: '@',
      bubbles: true,
      cancelable: true,
    });
    runtime.root.dispatchEvent(keyboard);
    runtime.root.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: '@',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(keyboard.defaultPrevented).toBe(false);
    expect(
      [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'inline-search'
      )
    ).toHaveLength(1);
    expect(menu.isOpen()).toBe(true);
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
    dispose();
    dispose();
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(false);
    menu.setSearchTerm('local');
    menu.setIsOpen(true);
    dispatchApplicationCommand(runtime.view, 'group-a.search-close', {});
    expect(menu.isOpen()).toBe(true);
    expect(menu.searchTerm()).toBe('local');
    expect(
      [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'inline-search'
      )
    ).toHaveLength(0);
  } finally {
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('partial root attachment releases real Enter/event registrations and retains opaque cause', async () => {
  const runtime = mount();
  const menu = createMenuOperations();
  const add = runtime.root.addEventListener.bind(runtime.root);
  const spy = vi
    .spyOn(runtime.root, 'addEventListener')
    .mockImplementation((name, listener, options) => {
      if (name === 'beforeinput') throw undefined;
      add(name, listener, options);
    });
  let observed = false;
  try {
    try {
      registerNativeMentionSearch(runtime.view, menu);
    } catch (error) {
      observed = true;
      expect(error).toBeUndefined();
    }
    expect(observed).toBe(true);
    spy.mockRestore();
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(false);
    trigger(runtime);
    expect(menu.isOpen()).toBe(false);
    expect(menu.searchTerm()).toBe('');
  } finally {
    spy.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('invalid real query reply disables only the menu and leaves native editing admitted', async () => {
  const runtime = mount();
  const menu = createMenuOperations();
  const unavailable = vi.fn();
  const query = runtime.port.query.bind(runtime.port);
  const fault = vi
    .spyOn(runtime.port, 'query')
    .mockImplementation((request) => ({
      ...query(request),
      text: 'null',
    }));
  const dispose = registerNativeMentionSearch(runtime.view, menu, unavailable);
  try {
    expect(fault).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledExactlyOnceWith(
      new Error('Invalid native inline-search controller snapshot')
    );
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(false);
    runtime.port.command(CommandCode.InsertText, 0, 0, 'still editable');
    expect(runtime.root.textContent).toBe('still editablebody');
    expect(fault).toHaveBeenCalledTimes(1);
  } finally {
    dispose();
    fault.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('optional partial menu attachment retains an opaque failure and releases bindings without closing the document', async () => {
  const runtime = mount();
  const menu = createMenuOperations();
  const unavailable = vi.fn();
  const add = runtime.root.addEventListener.bind(runtime.root);
  const fault = vi
    .spyOn(runtime.root, 'addEventListener')
    .mockImplementation((name, listener, options) => {
      if (name === 'beforeinput') throw undefined;
      add(name, listener, options);
    });
  const dispose = registerNativeMentionSearch(runtime.view, menu, unavailable);
  try {
    expect(unavailable).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(false);
    fault.mockRestore();
    runtime.root.dispatchEvent(
      new KeyboardEvent('keydown', { key: '@', bubbles: true })
    );
    runtime.port.command(CommandCode.InsertText, 0, 0, 'literal');
    expect(runtime.root.textContent).toBe('literalbody');
    expect(
      [...runtime.view.mirror.values()].some(
        (node) => node.type === 'inline-search'
      )
    ).toBe(false);
  } finally {
    dispose();
    fault.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});
