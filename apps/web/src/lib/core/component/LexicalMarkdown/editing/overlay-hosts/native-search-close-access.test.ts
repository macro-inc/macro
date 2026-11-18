import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  type EditorView,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import { createMenuOperations } from '../../shared/inlineMenu';
import { createNativeActionMenuHost } from './native-actions';
import { registerNativeInlineSearch } from './native-inline-search';
import { createNativeTagsMenuHost } from './native-tags-menu';
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';

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

function mount(kind: 'mentions' | 'actions' | 'tags') {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-search-close-access',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      // RustMarkdownEditor tears the editor down on any reported session error.
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
          'native-search-close-access'
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
            // The actions trigger needs whitespace after the caret.
            children: [
              {
                type: 'text',
                version: 1,
                text: kind === 'mentions' ? 'body' : ' body',
              },
            ],
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
  const authorize = (write: boolean, comment: boolean) =>
    runtime.executor.run(() =>
      runtime.executor.session.authorization(
        true,
        write,
        comment,
        runtime.executor.now(),
        Date.now()
      )
    );
  const openSearch = () => {
    dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
      kind,
    });
    runtime.port.command(CommandCode.InsertText, 0, 0, 'person');
    expect(searchNodes()).toHaveLength(1);
  };
  const searchNodes = () =>
    [...runtime.view.mirror.values()].filter(
      (node) => node.type === 'inline-search'
    );
  return {
    ...runtime,
    root,
    errors,
    authorize,
    openSearch,
    searchNodes,
    async close() {
      await runtime.close();
      root.remove();
    },
  };
}

const hosts = {
  mentions: (view: EditorView) =>
    createNativeUserMentionMenuHost(
      view,
      { blockName: 'md', sourceDocumentId: 'document' },
      () => true
    ),
  actions: (view: EditorView) =>
    createNativeActionMenuHost(view, { requestTable: () => {} }, () => true),
  tags: (view: EditorView) => createNativeTagsMenuHost(view, () => true),
};

describe.each(['mentions', 'actions', 'tags'] as const)(
  '%s closeSearch',
  (kind) => {
    for (const [label, comment, access] of [
      ['view-only', false, Access.Read],
      ['comment-only', true, Access.CommentOnly],
    ] as const) {
      test(`a ${label} reader closing with no search keeps the editor alive`, async () => {
        const runtime = mount(kind);
        try {
          runtime.authorize(false, comment);
          expect(runtime.executor.session.effectiveAccess()).toBe(access);
          const before = runtime.view.query.serializedState();
          hosts[kind](runtime.view).closeSearch();
          expect(runtime.errors).toEqual([]);
          expect(runtime.view.query.serializedState()).toBe(before);
        } finally {
          await runtime.close();
        }
      });

      test(`a search left open when ${label} access arrives is not written on close`, async () => {
        const runtime = mount(kind);
        try {
          runtime.openSearch();
          runtime.authorize(false, comment);
          const before = runtime.view.query.serializedState();
          hosts[kind](runtime.view).closeSearch();
          expect(runtime.errors).toEqual([]);
          expect(runtime.view.query.serializedState()).toBe(before);
          expect(runtime.searchNodes()).toHaveLength(1);
        } finally {
          await runtime.close();
        }
      });
    }

    test('a revoke queued before the close is consumed skips the model close', async () => {
      const runtime = mount(kind);
      try {
        runtime.openSearch();
        const host = hosts[kind](runtime.view);
        // Inside one executor turn: the close queues behind the running revoke.
        runtime.executor.run(() => {
          host.closeSearch();
          return runtime.executor.session.authorization(
            true,
            false,
            true,
            runtime.executor.now(),
            Date.now()
          );
        });
        expect(runtime.executor.session.effectiveAccess()).toBe(
          Access.CommentOnly
        );
        expect(runtime.errors).toEqual([]);
        expect(runtime.searchNodes()).toHaveLength(1);
      } finally {
        await runtime.close();
      }
    });

    test('session edit access closes the search even with UI editing off', async () => {
      const runtime = mount(kind);
      try {
        runtime.openSearch();
        // Source admits programmatic updates independently of UI editability.
        runtime.view.setEditable(false);
        hosts[kind](runtime.view).closeSearch();
        expect(runtime.errors).toEqual([]);
        expect(runtime.searchNodes()).toHaveLength(0);
      } finally {
        await runtime.close();
      }
    });

    test('an editor closing an open search still closes it in the model', async () => {
      const runtime = mount(kind);
      try {
        runtime.openSearch();
        hosts[kind](runtime.view).closeSearch();
        expect(runtime.errors).toEqual([]);
        expect(runtime.searchNodes()).toHaveLength(0);
        expect(runtime.root.textContent).toContain('person');
      } finally {
        await runtime.close();
      }
    });
  }
);

// Synthetic contract proxy for a view before its first projection, not a real cold mount.
test('a host on a view with no key generation does nothing', async () => {
  const runtime = mount('mentions');
  try {
    runtime.authorize(false, true);
    const view = Object.create(runtime.view, {
      mirror: { value: { ...runtime.view.mirror, keyGeneration: null } },
    });
    hosts.mentions(view).closeSearch();
    hosts.actions(view).closeSearch();
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

const TRIGGERS = { mentions: '@', actions: '/', tags: '#' } as const;

describe.each(['mentions', 'actions', 'tags'] as const)(
  '%s trigger key',
  (kind) => {
    const press = (runtime: ReturnType<typeof mount>) =>
      runtime.view.root.dispatchEvent(
        new KeyboardEvent('keydown', { key: TRIGGERS[kind], bubbles: true })
      );
    for (const [label, comment] of [
      ['view-only', false],
      ['comment-only', true],
    ] as const) {
      // A reader's focus can sit on a body descendant (a link, a decorator button).
      test(`a ${label} reader pressing the trigger keeps the editor alive`, async () => {
        const runtime = mount(kind);
        const dispose = registerNativeInlineSearch(
          runtime.view,
          createMenuOperations(),
          kind,
          TRIGGERS[kind]
        );
        try {
          runtime.authorize(false, comment);
          const before = runtime.view.query.serializedState();
          press(runtime);
          expect(runtime.errors).toEqual([]);
          expect(runtime.view.query.serializedState()).toBe(before);
        } finally {
          dispose();
          await runtime.close();
        }
      });
    }

    test('an editor pressing the trigger still starts a real search', async () => {
      const runtime = mount(kind);
      const dispose = registerNativeInlineSearch(
        runtime.view,
        createMenuOperations(),
        kind,
        TRIGGERS[kind]
      );
      try {
        press(runtime);
        runtime.port.command(CommandCode.InsertText, 0, 0, 'person');
        expect(runtime.errors).toEqual([]);
        expect(runtime.searchNodes()).toHaveLength(1);
      } finally {
        dispose();
        await runtime.close();
      }
    });
  }
);
