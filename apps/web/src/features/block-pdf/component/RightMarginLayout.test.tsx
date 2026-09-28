import { createPdfDraftThreadId } from '@block-pdf/type/comments';
import type { ThreadId } from '@core/comments/commentType';
import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { RightMarginLayout } from './RightMarginLayout';

const state = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  threads: (() => []) as () => Array<{
    threadId: ThreadId;
    layout: { calculatedYPos: number };
  }>,
}));

vi.mock('@block-pdf/store/comments/commentLayout', () => ({
  usePageCommentLayout: () => ({
    threads: state.threads,
    setThreadHeight: vi.fn(),
  }),
}));

vi.mock('@block-pdf/store/comments/commentOperations', () => ({
  useCreateComment: () => vi.fn(),
  useCreateMessageComment: () => vi.fn(),
  useDeleteComment: () => vi.fn(),
  useUpdateComment: () => vi.fn(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-id',
}));

vi.mock('../context/pdf-comments-context', () => ({
  usePdfComments: () => ({
    activeThreadId: () => null,
    selectedThreadId: () => null,
    byId: () => new Map(),
    activateThread: vi.fn(),
    clearActiveThread: vi.fn(),
    selectThread: vi.fn(),
  }),
}));

vi.mock('../context/pdf-document-context', () => ({
  usePdfDocument: () => ({
    documentId: () => 'document-id',
    annotations: { unified: false },
    isNested: () => false,
    permissions: {
      canComment: () => true,
      isOwner: () => true,
    },
  }),
}));

vi.mock('@core/comments/Thread', async () => {
  const { createContext, createEffect, onCleanup, onMount } = await import(
    'solid-js'
  );

  return {
    baseCommentTheme: { text: { base: '' } },
    CommentsContext: createContext(),
    noopCommentOperations: {},
    Thread: (props: {
      comment: { threadId: ThreadId };
      layout: { calculatedYPos: number };
    }) => {
      const element = document.createElement('div');
      element.dataset.testid = 'thread';

      createEffect(() => {
        element.textContent = `${props.comment.threadId}:${props.layout.calculatedYPos}`;
      });
      onMount(() => {
        state.mounts += 1;
      });
      onCleanup(() => {
        state.unmounts += 1;
      });

      return element;
    },
  };
});

beforeEach(() => {
  state.mounts = 0;
  state.unmounts = 0;
});

it('preserves a thread component when its measured layout changes', async () => {
  const [threads, setThreads] = createSignal([
    {
      threadId: 1,
      layout: { calculatedYPos: 10 },
    },
  ]);
  state.threads = threads;

  render(() => <RightMarginLayout pageIndex={0} />);
  expect(screen.getByTestId('thread').textContent).toBe('1:10');
  expect(state.mounts).toBe(1);

  setThreads([
    {
      threadId: 1,
      layout: { calculatedYPos: 20 },
    },
  ]);

  expect(screen.getByTestId('thread').textContent).toBe('1:20');
  expect(state.mounts).toBe(1);
  expect(state.unmounts).toBe(0);
});

it('renders drafts with distinct client thread identities', () => {
  const highlightDraftId = createPdfDraftThreadId(
    'highlight',
    'highlight-anchor'
  );
  const freeDraftId = createPdfDraftThreadId('free', 'free-anchor');
  const [threads] = createSignal([
    {
      threadId: highlightDraftId,
      layout: { calculatedYPos: 10 },
    },
    {
      threadId: freeDraftId,
      layout: { calculatedYPos: 20 },
    },
  ]);
  state.threads = threads;

  render(() => <RightMarginLayout pageIndex={0} />);

  expect(
    screen.getAllByTestId('thread').map((thread) => thread.textContent)
  ).toEqual([`${highlightDraftId}:10`, `${freeDraftId}:20`]);
  expect(state.mounts).toBe(2);
});
