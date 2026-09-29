import type { InputHandle, InputSnapshot } from '@channel/Input';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import type { MessageListItem } from '@service-storage/messages';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpreadsheetCommentsCapability } from './context/spreadsheet-comments';
import type { SpreadsheetStore } from './primitives/create-spreadsheet-store';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  patch: vi.fn(),
  discussion: vi.fn(),
  data: [] as MessageListItem[],
  rootId: undefined as string | undefined,
  target: undefined as string | undefined,
  canComment: true,
  scroll: vi.fn(() => () => {}),
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
vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [
    {
      get comment_id() {
        return mocks.target;
      },
    },
  ],
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/signal/permissions', () => ({
  useCanComment: () => () => mocks.canComment,
}));
vi.mock('@core/util/url', () => ({ buildSimpleEntityUrl: () => 'link' }));
vi.mock('@ui/components/Button', () => ({
  Button: (p: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...p} />,
}));
vi.mock('@queries/messages/document-messages', () => ({
  useMessageRootsQuery: () => ({ isSuccess: true, data: mocks.data }),
  useMessageLink: (_parent: unknown, target: () => string | undefined) => ({
    rootId: () => (target() ? mocks.rootId : undefined),
    messageId: target,
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  newMessageId: () => 'new-id',
  useSendMessageMutation: () => ({ mutateAsync: mocks.send }),
  usePatchThreadMutation: () => ({ mutate: mocks.patch }),
}));
vi.mock('@core/messages/scroll-to-rendered-target', () => ({
  scrollToRenderedTarget: mocks.scroll,
}));
vi.mock('@core/messages/EntityDiscussion', () => ({
  EntityDiscussion: (props: {
    parent: unknown;
    canWrite: boolean;
    targetId: string | null;
    label: string;
  }) => {
    mocks.discussion(props);
    return <section>{props.label}</section>;
  },
}));
vi.mock('@channel/Input', () => ({
  ChannelInput: (props: {
    onSend: (snapshot: InputSnapshot) => Promise<void>;
    onReady: (handle: Pick<InputHandle, 'clear'>) => void;
  }) => {
    const [text, setText] = createSignal('');
    const [error, setError] = createSignal('');
    props.onReady({
      clear: () => {
        setText('');
      },
    });
    return (
      <>
        <input
          aria-label="Comment draft"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button
          onClick={async () => {
            try {
              await props.onSend({
                value: text(),
                attachments: [],
                mentions: [],
              });
            } catch {
              setError('Failed to post');
            }
          }}
        >
          Post
        </button>
        <span>{error()}</span>
      </>
    );
  },
}));
vi.mock('@channel/Input/message-payload', () => ({
  buildPostMessageSendPayload: ({ snapshot }: { snapshot: InputSnapshot }) => ({
    message: { content: snapshot.value, mentions: [], attachments: [] },
    optimisticAttachments: [],
  }),
}));
vi.mock('@core/messages/MessageThread', () => ({
  MessageThread: (props: {
    data: MessageListItem;
    targetId: string | null;
  }) => <article data-target={props.targetId}>{props.data.content}</article>,
}));

import { SpreadsheetComments } from './SpreadsheetComments';

const anchor = { sheetId: 'sheet1', sheetName: 'Budget', range: 'B4:C5' };
let cap: SpreadsheetCommentsCapability;
let active!: (id: string) => void;
let navigateAgain!: () => void;
let selection = { anchor: 'B4', focus: 'C5' };
function mount() {
  return render(() => {
    const [id, setId] = createSignal('sheet1');
    active = setId;
    const params = createParamsState();
    navigateAgain = () =>
      params.navigate(mocks.target ? { comment_id: mocks.target } : {});
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
      <ParamsProvider state={params}>
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
      </ParamsProvider>
    );
  });
}
beforeEach(() => {
  mocks.data = [
    {
      id: 'root-id',
      parent: { type: 'document', id: 'doc' },
      sender_id: 'me',
      content: 'Check assumptions',
      mentions: [],
      attachments: [],
      reactions: [],
      created_at: '',
      updated_at: '',
      state: {
        root_id: 'root-id',
        user_id: 'me',
        resolved: false,
        anchor: { type: 'spreadsheet', ...anchor },
        created_at: '',
        updated_at: '',
      },
      thread: { reply_count: 0, preview: [], latest_reply_at: null },
    },
  ];
  mocks.send.mockResolvedValue({ id: 'new-id' });
  mocks.rootId = 'root-id';
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
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'document', id: 'doc' },
        message: expect.objectContaining({
          anchor: { type: 'spreadsheet', ...anchor },
        }),
      })
    )
  );
});
it('shows shared threads on hover, resolves them, and pins the card when interacted with', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  expect(mocks.patch).toHaveBeenCalledWith({
    parent: { type: 'document', id: 'doc' },
    rootId: 'root-id',
    patch: { resolved: true },
  });
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
  mocks.target = 'reply-id';
  mount();
  expect(
    screen.getByRole('complementary', { name: 'Spreadsheet comments' })
  ).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('B4:C5');
  cleanup();
  mocks.data[0].state.anchor = {
    type: 'spreadsheet',
    ...anchor,
    sheetId: 'deleted',
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
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'document', id: 'doc' },
        message: expect.objectContaining({
          anchor: { type: 'spreadsheet', ...anchor },
        }),
      })
    )
  );
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(
    'Comments on Budget · D9'
  );
  expect(screen.getByRole('dialog').querySelector('input')).toBeTruthy();
});

it('mounts a workbook discussion on the document parent without legacy comment links', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
  expect(mocks.discussion).toHaveBeenCalledWith(
    expect.objectContaining({
      parent: { type: 'document', id: 'doc' },
      canWrite: true,
      targetId: null,
    })
  );
  expect(screen.getByText('Workbook discussion')).toBeTruthy();
});

it.each(['root-id', 'reply-id'])(
  'keeps a range link (%s) out of the workbook discussion',
  (target) => {
    mocks.target = target;
    mount();
    expect(mocks.discussion).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: null })
    );
    expect(screen.getByRole('status').textContent).toBe('B4:C5');
    expect(document.querySelector(`[data-target="${target}"]`)).toBeTruthy();
  }
);

it.each(['root-id', 'reply-id'])(
  'passes a workbook link (%s) to the workbook discussion',
  (target) => {
    mocks.target = target;
    mocks.data[0].state.anchor = null;
    mount();
    expect(mocks.discussion).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: target })
    );
    expect(screen.getByRole('status').textContent).toBe('');
  }
);

it('clears a previous range highlight for a workbook link and preserves the draft range', async () => {
  mocks.data.push({
    ...mocks.data[0],
    id: 'workbook-root',
    state: { ...mocks.data[0].state, root_id: 'workbook-root', anchor: null },
  });
  mocks.target = 'reply-id';
  mount();
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Range draft' } });
  selection = { anchor: 'D9', focus: 'D9' };

  mocks.target = 'workbook-reply';
  mocks.rootId = 'workbook-root';
  navigateAgain();

  expect(screen.getByRole('status').textContent).toBe('');
  expect(mocks.discussion).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: 'workbook-reply' })
  );
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('Range draft');
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() =>
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          content: 'Range draft',
          anchor: { type: 'spreadsheet', ...anchor },
        }),
      })
    )
  );
});

it('clears a previous range navigation error when opening a workbook link', () => {
  mocks.data.push({
    ...mocks.data[0],
    id: 'workbook-root',
    state: { ...mocks.data[0].state, root_id: 'workbook-root', anchor: null },
  });
  mocks.data[0].state.anchor = {
    type: 'spreadsheet',
    ...anchor,
    sheetId: 'deleted',
  };
  mocks.target = 'reply-id';
  mount();
  expect(
    screen.getByText('This comment refers to a sheet that has been deleted.')
  ).toBeTruthy();

  mocks.target = 'workbook-reply';
  mocks.rootId = 'workbook-root';
  navigateAgain();

  expect(
    screen.queryByText('This comment refers to a sheet that has been deleted.')
  ).toBeNull();
  expect(mocks.discussion).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: 'workbook-reply' })
  );
});

it('leaves the workbook discussion untargeted until the root anchor is known', () => {
  mocks.target = 'reply-id';
  mocks.data[0].state.anchor = undefined;
  mount();
  expect(mocks.discussion).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: null })
  );
});

it('keeps failed range drafts and hides posting controls from viewers', async () => {
  mocks.send.mockRejectedValueOnce(new Error('offline'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(screen.getByText('Failed to post')).toBeTruthy());
  expect(input.value).toBe('Keep this draft');
  cleanup();
  mocks.canComment = false;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  expect(mocks.discussion).toHaveBeenLastCalledWith(
    expect.objectContaining({ canWrite: false })
  );
});

it('does not navigate to legacy numeric comments or mark deleted threads', () => {
  mocks.target = '42';
  mocks.data[0].state.deleted_at = '2026-09-28T00:00:00Z';
  mount();
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(cap.hasComment('B4')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
  expect(mocks.discussion).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: null })
  );
});

it('scrolls and highlights a linked reply again when the notification is reopened', async () => {
  mocks.target = 'reply-id';
  mount();
  await waitFor(() =>
    expect(mocks.scroll).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'reply-id'
    )
  );
  const calls = mocks.scroll.mock.calls.length;
  navigateAgain();
  await waitFor(() =>
    expect(mocks.scroll.mock.calls.length).toBeGreaterThan(calls)
  );
  expect(document.querySelector('[data-target="reply-id"]')).toBeTruthy();
});

it('keeps out-of-grid range threads readable without rendering an invalid marker', () => {
  mocks.target = 'reply-id';
  mocks.data[0].state.anchor = {
    type: 'spreadsheet',
    ...anchor,
    range: 'AA1:AB2',
  };
  mount();
  expect(screen.getByText('Check assumptions')).toBeTruthy();
  expect(
    screen.getByText(
      'The cells referenced by this comment are no longer available.'
    )
  ).toBeTruthy();
  expect(cap.hasComment('A1')).toBe(false);
});
