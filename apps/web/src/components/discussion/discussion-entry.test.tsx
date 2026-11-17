import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import type { MessageData } from '@core/messages/types';
import MacroLogo from '@icon/macro-logo.svg';
import type { MessageListItem } from '@service-storage/messages';
import {
  render as baseRender,
  cleanup,
  fireEvent,
  screen,
  within,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionEntry } from './discussion-entry';
import { discussionPreview } from './discussion-preview';

const TestQueryClientProvider = (props: { children: JSX.Element }) => (
  <QueryClientProvider client={new QueryClient()}>
    {props.children}
  </QueryClientProvider>
);
const render = (ui: Parameters<typeof baseRender>[0]) =>
  baseRender(ui, { wrapper: TestQueryClientProvider });

const avatarState = vi.hoisted(() => ({
  photoUrl: '',
  openDirectMessage: vi.fn(),
}));

vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: () => 'Member',
  getDisplayNameParts: () => ({ firstName: 'Member', lastName: '' }),
  getInitials: () => 'M',
  getInitialsFromName: (name: string) => name.charAt(0),
  macroIdToEmail: (id: string) => id,
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@core/signal/profilePicture', () => ({
  useProfilePictureUrl: () => [() => avatarState.photoUrl],
}));
vi.mock('@core/util/open-direct-message', () => ({
  useOpenDirectMessage: () => avatarState.openDirectMessage,
}));

afterEach(() => {
  cleanup();
  avatarState.photoUrl = '';
  avatarState.openDirectMessage.mockClear();
});

const MESSAGE: MessageListItem = {
  id: 'comment',
  parent: { type: 'initiative', id: 'project' },
  sender_id: 'member',
  content: 'Latest project update',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
  mentions: [],
  attachments: [],
  reactions: [],
  state: {
    root_id: 'comment',
    user_id: 'member',
    anchor: null,
    resolved: false,
    created_at: '',
    updated_at: '',
  },
  thread: { reply_count: 1, preview: [], latest_reply_at: null },
};

it('starts an empty discussion', () => {
  const open = vi.fn();
  render(() => (
    <DiscussionEntry preview={discussionPreview([])} onOpen={open} />
  ));
  fireEvent.click(screen.getByRole('button', { name: /Start a discussion/ }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText('M')).toBeNull();
  expect(screen.queryByText('View discussion')).toBeNull();
});

it('opens the thread from the newest comment card', () => {
  const message = MESSAGE;
  const open = vi.fn();
  render(() => (
    <StaticMarkdownContext>
      <DiscussionEntry preview={discussionPreview([message])} onOpen={open} />
    </StaticMarkdownContext>
  ));
  fireEvent.click(
    screen.getByRole('button', {
      name: /Latest project update.*View discussion/,
    })
  );
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getAllByText('M')).toHaveLength(2);
  expect(screen.queryByText(/^\d+\+? comments?$/)).toBeNull();
});

it('keeps surviving replies reachable when their root is deleted', () => {
  const root = {
    ...MESSAGE,
    id: 'root',
    content: 'Root comment',
    state: { ...MESSAGE.state, root_id: 'root' },
    thread: { ...MESSAGE.thread, reply_count: 2 },
  };
  const [message, setMessage] = createSignal(root);
  const open = vi.fn();
  render(() => (
    <StaticMarkdownContext>
      <DiscussionEntry preview={discussionPreview([message()])} onOpen={open} />
    </StaticMarkdownContext>
  ));
  expect(screen.getByText('View discussion')).toBeTruthy();

  setMessage({ ...root, deleted_at: '2026-10-02T12:00:00Z' });
  expect(screen.queryByText('Root comment')).toBeNull();
  expect(screen.queryByText('Start a discussion')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View discussion' }));
  expect(open).toHaveBeenCalledOnce();

  setMessage({
    ...message(),
    state: { ...root.state, deleted_at: '2026-10-02T12:00:00Z' },
  });
  expect(screen.getByText('Start a discussion')).toBeTruthy();
  expect(screen.queryByText('View discussion')).toBeNull();
});

it('shows profile photos in the newest card and participant group without intercepting entry clicks', () => {
  avatarState.photoUrl = '/profile.png';
  const open = vi.fn();
  const { container } = render(() => (
    <StaticMarkdownContext>
      <DiscussionEntry preview={discussionPreview([MESSAGE])} onOpen={open} />
    </StaticMarkdownContext>
  ));

  const photos = container.querySelectorAll('img');
  expect(photos).toHaveLength(2);
  for (const photo of photos) {
    expect(photo.getAttribute('src')).toContain('/profile.png');
    fireEvent.mouseDown(photo);
    fireEvent.click(photo);
  }
  expect(avatarState.openDirectMessage).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it.each([
  {
    label: 'team bot',
    sender_id: 'bot|11111111-2222-3333-4444-555555555555',
    sender: {
      type: 'bot',
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Helper',
      avatar_url: '/helper.png',
    },
    image: '/helper.png',
  },
  {
    label: 'imported author',
    sender_id: '',
    imported_author: { name: 'Imported author', avatar_url: '/imported.png' },
    image: '/imported.png',
  },
] satisfies (Partial<MessageData> & { label: string; image: string })[])(
  'keeps the $label image in the newest card and participant group',
  ({ label: _label, image, ...identity }) => {
    const { container } = render(() => (
      <StaticMarkdownContext>
        <DiscussionEntry
          preview={discussionPreview([{ ...MESSAGE, ...identity }])}
          onOpen={() => {}}
        />
      </StaticMarkdownContext>
    ));
    const photos = container.querySelectorAll('img');
    expect(photos).toHaveLength(2);
    for (const photo of photos) {
      expect(photo.getAttribute('src')).toContain(image);
    }
  }
);

it('keeps first-party bot marks in the newest card and participant group', () => {
  const { container } = render(() => (
    <StaticMarkdownContext>
      <DiscussionEntry
        preview={discussionPreview([
          { ...MESSAGE, sender_id: MACRO_AGENT_PRINCIPAL_ID },
        ])}
        onOpen={() => {}}
      />
    </StaticMarkdownContext>
  ));
  const { container: reference } = render(() => <MacroLogo />);
  const marks = container.querySelectorAll('[data-slot="avatar"] svg');
  expect(marks).toHaveLength(2);
  for (const mark of marks) {
    expect(mark.innerHTML).toBe(reference.querySelector('svg')?.innerHTML);
  }
});

it('uses the channel guest fallback without inventing a profile', () => {
  const { container } = render(() => (
    <StaticMarkdownContext>
      <DiscussionEntry
        preview={discussionPreview([
          { ...MESSAGE, sender_id: 'guest:visitor', guest_name: 'Visitor' },
        ])}
        onOpen={() => {}}
      />
    </StaticMarkdownContext>
  ));
  expect(container.querySelectorAll('img')).toHaveLength(0);
  expect(screen.getAllByText('V')).toHaveLength(2);
  expect(
    within(screen.getByRole('button')).getByText('Visitor (Guest)')
  ).toBeTruthy();
});
