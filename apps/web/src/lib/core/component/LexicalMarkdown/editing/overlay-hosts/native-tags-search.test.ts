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
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createMenuOperations } from '../../shared/inlineMenu';
import { createNativeTagsMenuHost } from './native-tags-menu';
import { registerNativeTagsSearch } from './native-tags-search';

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

function mount(body: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-tags-search',
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
          'native-tags-search'
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
            children: [{ type: 'text', version: 1, text: body }],
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
    anchor: { key: text.key, offset: body.length, type: 'text' },
    focus: { key: text.key, offset: body.length, type: 'text' },
  });
  runtime.view.focus();
  return { ...runtime, root };
}

const hash = (root: HTMLElement) =>
  root.dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true }));
const searches = (runtime: ReturnType<typeof mount>) =>
  [...runtime.view.mirror.values()].filter(
    (node) => node.type === 'inline-search'
  );

test('# opens the tags menu, and a second # while open collapses it', async () => {
  const runtime = mount('see (');
  const menu = createMenuOperations();
  const dispose = registerNativeTagsSearch(runtime.view, menu);
  try {
    hash(runtime.root);
    runtime.port.command(CommandCode.InsertText, 0, 0, 'road');
    expect(searches(runtime)).toHaveLength(1);
    expect(menu.isOpen()).toBe(true);
    expect(menu.searchTerm()).toBe('road');
    hash(runtime.root);
    expect(menu.isOpen()).toBe(false);
    expect(searches(runtime)).toHaveLength(0);
    expect(runtime.root.textContent).toBe('see (#road');
  } finally {
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('# after a word character stays literal text', async () => {
  const runtime = mount('word');
  const menu = createMenuOperations();
  const dispose = registerNativeTagsSearch(runtime.view, menu);
  try {
    hash(runtime.root);
    runtime.port.command(CommandCode.InsertText, 0, 0, '#');
    expect(searches(runtime)).toHaveLength(0);
    expect(menu.isOpen()).toBe(false);
  } finally {
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('host insertion replaces the search with an actual tag mention', async () => {
  const runtime = mount('see ');
  const menu = createMenuOperations();
  const dispose = registerNativeTagsSearch(runtime.view, menu);
  try {
    hash(runtime.root);
    runtime.port.command(CommandCode.InsertText, 0, 0, 'ro');
    const host = createNativeTagsMenuHost(runtime.view, () => true);
    host.insertTag({
      optionId: 'option-1',
      propertyDefinitionId: 'definition-1',
      scope: 'team',
      name: 'Roadmap',
    });
    await runtime.executor.idle();
    expect(searches(runtime)).toHaveLength(0);
    expect(
      [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'tag-mention'
      )
    ).toHaveLength(1);
    expect(menu.isOpen()).toBe(false);
  } finally {
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});
