import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, For, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpreadsheetCommentsCapability } from './context/spreadsheet-comments';
import type { SpreadsheetStore } from './primitives/create-spreadsheet-store';

const mocks = vi.hoisted(() => ({
  api: { create: vi.fn(), edit: vi.fn(), delete: vi.fn() },
  refresh: vi.fn(async () => {}),
  data: [] as CommentThread[],
  target: undefined as string | undefined,
  canComment: true,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderRight: (p: ParentProps) => p.children,
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (p: ParentProps) => p.children,
}));
vi.mock('@core/component/LexicalMarkdown/directive/floatWithElement', () => ({
  floatWithElement: () => {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({ StaticMarkdownContext: (p: ParentProps) => p.children })
);
vi.mock('@core/component/ParamsProvider', () => ({
  useUrlParams: () => ({ commentId: () => mocks.target }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/signal/permissions', () => ({
  useCanComment: () => () => mocks.canComment,
}));
vi.mock('@core/util/url', () => ({ buildSimpleEntityUrl: () => 'link' }));
vi.mock('@ui/components/Button', () => ({
  Button: (p: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...p} />,
}));
vi.mock('./queries/spreadsheet-comments', () => ({
  useSpreadsheetComments: () => ({
    query: { isSuccess: true, data: mocks.data },
    api: mocks.api,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@core/comments/discussion', async () => {
  const { DiscussionProvider, useDiscussion } = await import(
    '@core/comments/discussion/context'
  );
  return {
    DiscussionProvider,
    Discussion: () => <div>Thread list</div>,
    DiscussionComposer: () => {
      const source = useDiscussion();
      const [text, setText] = createSignal('');
      return (
        <>
          <input
            aria-label="Comment draft"
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <button onClick={() => source.createThread(text(), [])}>Post</button>
        </>
      );
    },
    DiscussionThreadView: (p: {
      thread: { id: string; comments: { text: string }[] };
    }) => {
      const source = useDiscussion();
      return (
        <>
          <For each={p.thread.comments}>{(c) => <p>{c.text}</p>}</For>
          <button
            onClick={() =>
              source.createReply(p.thread.id, 'Reply from card', [])
            }
          >
            Reply
          </button>
        </>
      );
    },
  };
});

import { SpreadsheetComments } from './SpreadsheetComments';

const anchor = { sheetId: 'sheet1', sheetName: 'Budget', range: 'B4:C5' };
let cap: SpreadsheetCommentsCapability;
let active!: (id: string) => void;
let selection = { anchor: 'B4', focus: 'C5' };
function mount() {
  return render(() => {
    const [id, setId] = createSignal('sheet1');
    active = setId;
    const sheets = [
      { id: 'sheet1', name: 'Budget', layout: { rowCount: 200 }, cells: {} },
    ];
    const store = {
      ready: () => true,
      workbook: () => sheets,
      activeSheetId: id,
      activeSheet: () => sheets[0],
      selection: () => selection,
    } as unknown as SpreadsheetStore;
    return (
      <SpreadsheetComments documentId="doc" store={store}>
        {(location, comments) => {
          cap = comments;
          let cell!: HTMLButtonElement;
          return (
            <>
              <button
                ref={cell}
                onMouseEnter={() => comments.enter('B4', cell)}
                onMouseLeave={comments.leave}
              >
                B4
              </button>
              <button onClick={() => comments.add(cell)}>Comment</button>
              <output>{location()?.range}</output>
            </>
          );
        }}
      </SpreadsheetComments>
    );
  });
}
beforeEach(() => {
  mocks.data = [
    {
      thread: {
        threadId: 7,
        documentId: 'doc',
        owner: 'me',
        resolved: false,
        metadata: { spreadsheet: anchor },
      },
      comments: [
        { commentId: 42, threadId: 7, owner: 'me', text: 'Check assumptions' },
      ],
    },
  ];
  mocks.api.create.mockResolvedValue({ thread: { threadId: 8 }, comments: [] });
  mocks.target = undefined;
  mocks.canComment = true;
  selection = { anchor: 'B4', focus: 'C5' };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('offers a cell-anchored composer and freezes the range even if the grid selection moves', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(
    'Comments on Budget · B4:C5'
  );
  expect(screen.queryByRole('complementary')).toBeNull();
  selection = { anchor: 'D9', focus: 'D9' };
  fireEvent.input(screen.getByRole('textbox', { name: 'Comment draft' }), {
    target: { value: 'Check this' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() =>
    expect(mocks.api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        threadMetadata: expect.objectContaining({ spreadsheet: anchor }),
      })
    )
  );
});
it('shows existing comments on hover, replies in place, and pins the card when interacted with', async () => {
  mount();
  expect(cap.hasComment('B4')).toBe(true);
  expect(cap.hasComment('C5')).toBe(false);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'B4' }));
  await waitFor(() =>
    expect(screen.getByText('Check assumptions')).toBeTruthy()
  );
  fireEvent.pointerDown(screen.getByRole('dialog'));
  fireEvent.mouseLeave(screen.getByRole('button', { name: 'B4' }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() =>
    expect(mocks.api.create).toHaveBeenCalledWith({
      text: 'Reply from card',
      threadId: 7,
      mentions: undefined,
    })
  );
  expect(screen.queryByRole('complementary')).toBeNull();
  active('sheet2');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('dismisses unpinned previews and supports clicking a marker for touch/keyboard use', async () => {
  mount();
  const cell = screen.getByRole('button', { name: 'B4' });
  fireEvent.mouseEnter(cell);
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  fireEvent.mouseLeave(cell);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  cap.show('B4', cell);
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens notification targets at the linked range and keeps deleted-sheet threads accessible', async () => {
  mocks.target = '42';
  mount();
  expect(
    screen.getByRole('complementary', { name: 'Spreadsheet comments' })
  ).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('B4:C5');
  cleanup();
  mocks.data[0].thread.metadata = {
    spreadsheet: { ...anchor, sheetId: 'deleted' },
  };
  mount();
  expect(
    screen.getByText('This comment refers to a sheet that has been deleted.')
  ).toBeTruthy();
});

it('keeps sidebar and floating composer attachments independent', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
  selection = { anchor: 'D9', focus: 'D9' };
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  const panel = screen.getByRole('complementary');
  fireEvent.input(panel.querySelector('input')!, {
    target: { value: 'Sidebar draft' },
  });
  fireEvent.click(
    [...panel.querySelectorAll('button')].find(
      (button) => button.textContent === 'Post'
    )!
  );
  await waitFor(() =>
    expect(mocks.api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Sidebar draft',
        threadMetadata: expect.objectContaining({ spreadsheet: anchor }),
      })
    )
  );
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(
    'Comments on Budget · D9'
  );
  expect(screen.getByRole('dialog').querySelector('input')).toBeTruthy();
});
