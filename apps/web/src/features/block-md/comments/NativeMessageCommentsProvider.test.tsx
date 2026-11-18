import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { DRAFT_THREAD_ID } from '@core/comments/commentType';
import { createNativeComments } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-comments';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
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
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import { batch, createSignal } from 'solid-js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { finishQuoteControl } from './commentQuoteTestCleanup';
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
vi.mock('@queries/messages/posted-comment', () => ({
  hasPostedComment: async () => false,
}));
vi.mock('@queries/messages/sync', () => ({
  onThreadStateUpdated: () => () => {},
}));
vi.mock('./commentOperations', () => ({
  useDeleteNewComments: () => () => {},
}));

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  // jsdom has no layout for Range; the draft highlight reads no rectangles.
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
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
    comments,
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

test('a native draft opens from a real selection, survives a refused publication and discards', async () => {
  const harness = setup();
  try {
    harness.finishLoading();
    const controls = harness.state.editor.md.commentDraft;
    if (!controls) throw new Error('Missing native draft controls');

    // A collapsed caret has no commentable text (Source no_selection).
    harness.caretInMark();
    expect(controls.create()).toBe(false);

    const before = [...harness.session.view.mirror.values()].find(
      (node) => node.kind === 'text' && node.text === 'before '
    );
    if (!before) throw new Error('Missing native text');
    harness.session.port.selectionFromView({
      kind: 'range',
      anchor: { key: before.key, offset: 0, type: 'text' },
      focus: { key: before.key, offset: 6, type: 'text' },
    });
    expect(controls.create()).toBe(true);
    const id = controls.current();
    if (!id) throw new Error('Missing draft id');
    const mark = harness.state.comments.marks[id];
    expect(mark?.isDraft).toBe(true);
    expect(mark?.existsOnServer).toBe(false);
    expect(mark?.publication?.text()).toBe('before');
    expect(harness.state.comments.activeMarkIds).toEqual([id]);
    expect(harness.state.comments.activeCommentThread).toBe(DRAFT_THREAD_ID);
    // Retrying Comment keeps the one draft.
    expect(controls.create()).toBe(true);
    expect(controls.current()).toBe(id);

    // No transport: the session refuses the mark, so the draft remains.
    expect(await mark?.publication?.publish()).toBe(false);
    expect(controls.current()).toBe(id);
    expect(harness.state.comments.marks[id]).toBeDefined();

    controls.discard();
    expect(controls.current()).toBeUndefined();
    expect(harness.state.comments.marks[id]).toBeUndefined();
  } finally {
    await harness.close();
  }
});

test('the native draft highlight follows its durable cursors through edits', async () => {
  const harness = setup();
  // jsdom has no layout: one rect per range, as wide as the range's text.
  const ranges: string[] = [];
  const emptyRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function (this: Range) {
    ranges.push(this.toString());
    return Object.assign([new DOMRect(0, 0, this.toString().length, 10)], {
      item: () => null,
    }) as unknown as DOMRectList;
  };
  try {
    harness.finishLoading();
    const controls = harness.state.editor.md.commentDraft;
    if (!controls) throw new Error('Missing native draft controls');
    const before = [...harness.session.view.mirror.values()].find(
      (node) => node.kind === 'text' && node.text === 'before '
    );
    if (!before) throw new Error('Missing native text');
    const select = (anchor: number, focus: number) =>
      harness.session.port.selectionFromView({
        kind: 'range',
        anchor: { key: before.key, offset: anchor, type: 'text' },
        focus: { key: before.key, offset: focus, type: 'text' },
      });
    const highlights = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-comment-draft-highlight]'
        ),
      ].map((element) => element.style.width);

    select(0, 6);
    expect(controls.create()).toBe(true);
    const draftId = controls.current();
    if (!draftId) throw new Error('Missing draft id');
    const publication = harness.state.comments.marks[draftId]?.publication;
    expect(publication?.text()).toBe('before');
    expect(ranges.at(-1)).toBe('before');
    expect(highlights()).toEqual(['6px']);

    // An edit before the range shifts it; the highlight keeps the same text.
    select(0, 0);
    harness.session.port.command(CommandCode.InsertText, 0, 0, 'XY');
    expect(ranges.at(-1)).toBe('before');
    expect(highlights()).toEqual(['6px']);

    // An edit inside the range widens it, and the highlight stays visible.
    select(5, 5);
    harness.session.port.command(CommandCode.InsertText, 0, 0, 'Z');
    expect(ranges.at(-1)).toBe('befZore');
    expect(highlights()).toEqual(['7px']);
    expect(controls.current()).toBeDefined();
    expect(publication?.text()).toBe('befZore');

    controls.discard();
    expect(highlights()).toEqual([]);
  } finally {
    Range.prototype.getClientRects = emptyRects;
    await harness.close();
  }
});

function draftHarness() {
  const harness = setup();
  harness.finishLoading();
  const controls = harness.state.editor.md.commentDraft;
  if (!controls) throw new Error('Missing native draft controls');
  const text = (value: string) => {
    const node = [...harness.session.view.mirror.values()].find(
      (entry) => entry.kind === 'text' && entry.text === value
    );
    if (!node) throw new Error(`Missing native text ${value}`);
    return node;
  };
  const select = (value: string, anchor: number, focus: number) =>
    harness.session.port.selectionFromView({
      kind: 'range',
      anchor: { key: text(value).key, offset: anchor, type: 'text' },
      focus: { key: text(value).key, offset: focus, type: 'text' },
    });
  const publication = (id: string) => {
    const value = harness.state.comments.marks[id]?.publication;
    if (!value) throw new Error(`Missing publication for ${id}`);
    return value;
  };
  const remove = vi.spyOn(harness.comments, 'remove').mockResolvedValue(true);
  return { ...harness, controls, select, publication, remove };
}

test('an abandoned native publication cleans up its own mark, never the newer draft', async () => {
  const harness = draftHarness();
  try {
    let finish!: (accepted: boolean) => void;
    vi.spyOn(harness.comments, 'publish').mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );
    harness.select('before ', 0, 6);
    expect(harness.controls.create()).toBe(true);
    const firstId = harness.controls.current();
    if (!firstId) throw new Error('Missing first draft');
    const firstPublish = harness.publication(firstId).publish();

    harness.controls.discard();
    harness.select('Commented text', 0, 9);
    expect(harness.controls.create()).toBe(true);
    const secondId = harness.controls.current();
    expect(secondId).not.toBe(firstId);

    finish(true);
    expect(await firstPublish).toBe(false);
    expect(harness.remove).toHaveBeenCalledExactlyOnceWith(firstId);
    expect(harness.controls.current()).toBe(secondId);
  } finally {
    await harness.close();
  }
});

test('a published native draft is removed on discard and kept once its comment posts', async () => {
  const harness = draftHarness();
  try {
    vi.spyOn(harness.comments, 'publish').mockResolvedValue(true);
    harness.select('before ', 0, 6);
    expect(harness.controls.create()).toBe(true);
    const discarded = harness.controls.current();
    if (!discarded) throw new Error('Missing draft');
    expect(await harness.publication(discarded).publish()).toBe(true);
    harness.controls.discard();
    await vi.waitFor(() =>
      expect(harness.remove).toHaveBeenCalledExactlyOnceWith(discarded)
    );

    harness.select('before ', 0, 6);
    expect(harness.controls.create()).toBe(true);
    const posted = harness.controls.current();
    if (!posted) throw new Error('Missing draft');
    expect(await harness.publication(posted).publish()).toBe(true);
    expect(
      await harness.publication(posted).post(async () => ({ id: 'message' }))
    ).toEqual({ id: 'message' });
    harness.controls.commit(posted);
    expect(harness.controls.current()).toBeUndefined();
    expect(harness.remove).not.toHaveBeenCalledWith(posted);

    // A send that succeeds after its draft was closed keeps the mark.
    harness.select('before ', 0, 6);
    expect(harness.controls.create()).toBe(true);
    const closed = harness.controls.current();
    if (!closed) throw new Error('Missing draft');
    expect(await harness.publication(closed).publish()).toBe(true);
    let deliver!: (value: { id: string }) => void;
    const sending = harness
      .publication(closed)
      .post(
        () => new Promise<{ id: string }>((resolve) => (deliver = resolve))
      );
    harness.controls.discard();
    deliver({ id: 'late' });
    expect(await sending).toEqual({ id: 'late' });
    expect(harness.remove).not.toHaveBeenCalledWith(closed);
  } finally {
    await harness.close();
  }
});

test('a native draft inside an existing comment leaves that comment on cancellation', async () => {
  const harness = draftHarness();
  try {
    harness.loadComments();
    harness.select('Commented text', 2, 7);
    expect(harness.controls.create()).toBe(true);
    expect(harness.state.comments.activeCommentThread).toBe(DRAFT_THREAD_ID);
    harness.controls.discard();
    expect(harness.remove).not.toHaveBeenCalled();
    expect(harness.state.comments.threads.root?.anchorId).toBe('mark');
    expect(harness.markElement()?.textContent).toBe('Commented text');
    expect(harness.state.comments.marks.mark?.existsOnServer).toBe(true);
  } finally {
    await harness.close();
  }
});

// The native view/cursors/lifecycle are real. Quote reads and service completion
// are controlled to pin the Source two-read/pre-flush chronology independently.
test('native quote publication snapshots its second read before flush without changing the bookmark', async () => {
  const harness = draftHarness();
  const read = vi
    .spyOn(harness.comments, 'draftText')
    .mockReturnValueOnce('message quote')
    .mockReturnValueOnce('before');
  const publish = vi.spyOn(harness.comments, 'publish');
  let drain: (() => void) | undefined;
  let pending: Promise<boolean> | undefined;
  let primary: { error: unknown } | undefined;
  const flush = vi.spyOn(harness.session.port, 'flush').mockImplementation(
    () =>
      new Promise((resolve) => {
        drain = () => resolve({ kind: 'drained' });
      })
  );
  const comment = vi
    .spyOn(harness.session.port, 'comment')
    .mockResolvedValue({ kind: 'accepted' });
  try {
    harness.select('before ', 0, 6);
    expect(harness.controls.create()).toBe(true);
    const id = harness.controls.current();
    if (!id) throw new Error('Missing draft');
    const publication = harness.publication(id);
    expect(publication.text()).toBe('message quote');
    pending = publication.publish();
    expect(read).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(1);
    const call = publish.mock.calls[0];
    if (!call) throw new Error('Missing publish call');
    const bookmark = call[1];
    const frozen = JSON.stringify(bookmark);
    expect(call[2]).toBe('before');
    read.mockReturnValue('after flush started');
    expect(comment).not.toHaveBeenCalled();
    if (!drain) throw new Error('Missing flush completion');
    drain();
    expect(await pending).toBe(true);
    expect(comment).toHaveBeenCalledWith(id, {
      kind: 'add',
      ...bookmark.cursors,
      text: 'before',
    });
    expect(JSON.stringify(bookmark)).toBe(frozen);
    expect(bookmark.text).toBe('before');
    expect(bookmark.cursors.text).toBe('before');
    expect(read).toHaveBeenCalledTimes(2);
  } catch (error) {
    primary = { error };
  } finally {
    await finishQuoteControl(primary, [
      () => {
        drain?.();
        drain = undefined;
      },
      async () => {
        if (pending) await pending;
      },
      // The mark service is controlled: retire its local draft without issuing
      // another held flush during resource cleanup.
      () => {
        const id = harness.controls.current();
        if (id) harness.controls.commit(id);
      },
      () => read.mockRestore(),
      () => publish.mockRestore(),
      () => flush.mockRestore(),
      () => comment.mockRestore(),
      () => harness.close(),
    ]);
  }
});

// Real draftText/query + real edit/cursors; only flush and external annotation
// completion are supplied. This is not an ACK, physical storage or browser proof.
test('actual range edit supplies the current quote to outgoing comment publication', async () => {
  const harness = draftHarness();
  const capture = vi.spyOn(harness.comments, 'captureSelection');
  const flush = vi
    .spyOn(harness.session.port, 'flush')
    .mockResolvedValue({ kind: 'drained' });
  const comment = vi
    .spyOn(harness.session.port, 'comment')
    .mockResolvedValue({ kind: 'accepted' });
  let pending: Promise<boolean> | undefined;
  let primary: { error: unknown } | undefined;
  try {
    harness.select('before ', 0, 6);
    expect(harness.controls.create()).toBe(true);
    const id = harness.controls.current();
    if (!id) throw new Error('Missing draft');
    const result = capture.mock.results[0];
    if (result?.type !== 'return' || !result.value)
      throw new Error('Missing captured bookmark');
    const bookmark = result.value;
    const frozen = JSON.stringify(bookmark);
    const publication = harness.publication(id);
    expect(publication.text()).toBe('before');
    harness.select('before ', 3, 3);
    harness.session.port.command(CommandCode.InsertText, 0, 0, 'Z');
    expect(publication.text()).toBe('befZore');
    expect(JSON.stringify(bookmark)).toBe(frozen);
    pending = publication.publish();
    expect(await pending).toBe(true);
    expect(comment).toHaveBeenCalledExactlyOnceWith(id, {
      kind: 'add',
      ...bookmark.cursors,
      text: 'befZore',
    });
    expect(bookmark.text).toBe('before');
    expect(bookmark.cursors.text).toBe('before');
    expect(JSON.stringify(bookmark)).toBe(frozen);
  } catch (error) {
    primary = { error };
  } finally {
    await finishQuoteControl(primary, [
      async () => {
        if (pending) await pending;
      },
      () => {
        const id = harness.controls.current();
        if (id) harness.controls.commit(id);
      },
      () => capture.mockRestore(),
      () => flush.mockRestore(),
      () => comment.mockRestore(),
      () => harness.close(),
    ]);
  }
});
