import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { RightMarginLayout } from './RightMarginLayout';

const state = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  threads: (() => []) as () => Array<{
    threadId: number;
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
    Thread: (props: {
      comment: { threadId: number };
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
