import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { createNativeComments } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-comments';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import { batch, createSignal } from 'solid-js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { NativeMessageCommentsProvider } from './NativeMessageCommentsProvider';

const mocks = vi.hoisted(() => ({
  state: undefined as
    | ReturnType<typeof createMarkdownDocumentState>
    | undefined,
  threads: (): MessageListItem[] => [],
  rootId: (): string | null => 'root',
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document',
    documentSource: () => ({
      type: 'sync',
      source: createNoopLiveSyncSource('document'),
    }),
    state: mocks.state,
    permissions: { canEdit: () => false, canComment: () => true },
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|reader@example.com',
}));
vi.mock('@core/component/ParamsProvider', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useParamNavigationCount: () => () => 0,
}));
vi.mock('@queries/messages/document-messages', () => ({
  useMessageRootsQuery: () => ({
    isSuccess: true,
    get data() {
      return mocks.threads();
    },
  }),
  useMessageLink: (_parent: unknown, target: () => string | undefined) => ({
    messageId: target,
    rootId: () => mocks.rootId(),
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  usePatchThreadMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@queries/messages/sync', () => ({
  onThreadStateUpdated: () => () => {},
}));
vi.mock('./commentOperations', () => ({
  useDeleteNewComments: () => () => {},
}));

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
        '../../../lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
afterEach(() => cleanup());

const thread: MessageListItem = {
  id: 'root',
  parent: { type: 'document', id: 'document' },
  sender_id: 'macro|reader@example.com',
  content: 'Root comment',
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: '2026-09-29T00:00:00Z',
  updated_at: '2026-09-29T00:00:00Z',
  state: {
    root_id: 'root',
    user_id: 'macro|reader@example.com',
    resolved: false,
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    anchor: { type: 'markdown', mark_id: 'mark' },
  },
  thread: { reply_count: 0, preview: [], latest_reply_at: null },
};

function mountSession() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-message-comments',
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
          'native-message-comments'
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
            children: [
              { type: 'text', version: 1, text: 'before ' },
              {
                type: 'comment-mark',
                version: 1,
                ids: ['mark'],
                isDraft: false,
                children: [
                  { type: 'text', version: 1, text: 'Commented text' },
                ],
              },
            ],
          },
        ],
      },
    })
  );
  return { ...runtime, root };
}

function setup() {
  const state = createMarkdownDocumentState();
  mocks.state = state;
  const [threads, setThreads] = createSignal<MessageListItem[]>([]);
  const [rootId, setRootId] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  const [activeComment, setActiveComment] = createSignal<string | undefined>(
    undefined,
    { equals: false }
  );
  mocks.threads = threads;
  mocks.rootId = rootId;
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const session = mountSession();
  const comments = createNativeComments(session.view);
  render(() => (
    <NativeMessageCommentsProvider
      activeComment={activeComment}
      comments={comments}
      ready={ready}
    />
  ));
  const markText = [...session.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === 'Commented text'
  );
  if (!markText) throw new Error('Missing native mark text');
  return {
    state,
    session,
    scroll,
    markElement: () => session.root.querySelector('mark'),
    caretInMark: () =>
      session.port.selectionFromView({
        kind: 'range',
        anchor: { key: markText.key, offset: 3, type: 'text' },
        focus: { key: markText.key, offset: 3, type: 'text' },
      }),
    finishLoading: () => setReady(true),
    loadComments: () =>
      batch(() => {
        setRootId('root');
        setThreads([thread]);
      }),
    navigate: (id: string) => setActiveComment(id),
    close: async () => {
      comments.dispose();
      await session.close();
      session.root.remove();
    },
  };
}

test('native marks bind to their server threads and follow the caret', async () => {
  const harness = setup();
  try {
    harness.finishLoading();
    harness.loadComments();
    const mark = harness.state.comments.marks.mark;
    expect(mark?.existsOnServer).toBe(true);
    expect(mark?.thread?.threadId).toBe('root');
    expect(Object.values(mark?.markNodes ?? {})).toEqual([
      harness.markElement(),
    ]);
    expect(harness.state.comments.threads.root?.anchorId).toBe('mark');

    harness.caretInMark();
    expect(harness.state.comments.activeMarkIds).toEqual(['mark']);
    expect(harness.state.comments.highlightedCommentThreads).toEqual(['root']);
    expect(harness.markElement()?.classList.contains('selected')).toBe(true);
  } finally {
    await harness.close();
  }
});

test('a comment link waits for the native body, then opens its thread', async () => {
  const harness = setup();
  try {
    harness.loadComments();
    harness.navigate('root');
    expect(harness.scroll).not.toHaveBeenCalled();
    harness.finishLoading();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(harness.scroll).toHaveBeenCalledOnce();
    expect(harness.state.comments.activeCommentThread).toBe('root');
  } finally {
    await harness.close();
  }
});
