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
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import { createMenuOperations } from '../../shared/inlineMenu';
import { createNativeEmojiMenuHost } from './native-emoji-menu';
import { createNativeSnippetMenuHost } from './native-snippets-menu';

const { fetchSnippetRaw } = vi.hoisted(() => ({ fetchSnippetRaw: vi.fn() }));
vi.mock('@queries/storage/snippets', () => ({ fetchSnippetRaw }));
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
beforeEach(() => {
  fetchSnippetRaw.mockReset();
});

function mount(kind: 'emojis' | 'snippets', typed: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      // The snippet placeholder's real view needs the await host.
      { await: () => null }
    ),
    {
      namespace: 'emoji-snippets',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError: (error) => errors.push(error),
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
          'emoji-snippets'
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
            children: [{ type: 'text', version: 1, text: 'body ' }],
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
    anchor: { key: text.key, offset: 5, type: 'text' },
    focus: { key: text.key, offset: 5, type: 'text' },
  });
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', { kind });
  runtime.port.command(CommandCode.InsertText, 0, 0, typed);
  expect(
    [...runtime.view.mirror.values()].some(
      (node) => node.type === 'inline-search'
    )
  ).toBe(true);
  return {
    ...runtime,
    errors,
    async close() {
      await runtime.close();
      root.remove();
    },
  };
}

const searches = (runtime: ReturnType<typeof mount>) =>
  [...runtime.view.mirror.values()].filter(
    (node) => node.type === 'inline-search'
  );

test('native emoji choice removes the search and inserts unformatted text', async () => {
  const runtime = mount('emojis', 'smi');
  try {
    const host = createNativeEmojiMenuHost(runtime.view, () => true);
    host.insertEmoji('😀');
    await vi.waitFor(() => expect(searches(runtime)).toHaveLength(0));
    await vi.waitFor(() =>
      expect(runtime.view.root.textContent).toBe('body 😀')
    );
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

test('native emoji search text reaches the shortcode resolver', async () => {
  const runtime = mount('emojis', 'smi');
  try {
    const host = createNativeEmojiMenuHost(runtime.view, () => true);
    const seen: string[] = [];
    host.registerSearchText((text) => seen.push(text));
    runtime.port.command(CommandCode.InsertText, 0, 0, 'le:');
    expect(seen.at(-1)).toBe(':smile:');
  } finally {
    await runtime.close();
  }
});

test('native snippet choice inserts the fetched snippet in place of the search', async () => {
  fetchSnippetRaw.mockResolvedValue({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'snippet body' }],
        },
      ],
    },
  });
  const runtime = mount('snippets', 'sn');
  const menu = createMenuOperations();
  menu.setIsOpen(true);
  const snippets = createNativeSnippetMenuHost(runtime.view, menu, {
    sourceDocumentId: 'target-document',
    alive: () => true,
  });
  try {
    snippets.host.insertSnippet('snippet-document');
    expect(menu.isOpen()).toBe(false);
    await vi.waitFor(() =>
      expect(runtime.view.root.textContent).toBe('body snippet body')
    );
    expect(fetchSnippetRaw).toHaveBeenCalledWith({
      documentId: 'snippet-document',
    });
    expect(searches(runtime)).toHaveLength(0);
    expect(
      [...runtime.view.mirror.values()].filter((node) => node.type === 'await')
    ).toHaveLength(0);
    expect(runtime.errors).toEqual([]);
  } finally {
    snippets.dispose();
    await runtime.close();
  }
});

test('native snippet refuses inserting a document into itself', async () => {
  const runtime = mount('snippets', 'sn');
  const menu = createMenuOperations();
  const snippets = createNativeSnippetMenuHost(runtime.view, menu, {
    sourceDocumentId: 'same-document',
    alive: () => true,
  });
  try {
    snippets.host.insertSnippet('same-document');
    expect(searches(runtime)).toHaveLength(1);
    expect(fetchSnippetRaw).not.toHaveBeenCalled();
  } finally {
    snippets.dispose();
    await runtime.close();
  }
});
