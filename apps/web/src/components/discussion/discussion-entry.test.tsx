import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionEntry } from './discussion-entry';
import { discussionPreview } from './discussion-preview';

vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: () => 'Member',
  getInitialsFromName: () => 'M',
}));
afterEach(cleanup);

it('opens the empty discussion to add a comment', () => {
  const open = vi.fn();
  render(() => (
    <DiscussionEntry preview={discussionPreview([])} onOpen={open} />
  ));
  fireEvent.click(screen.getByRole('button', { name: /Add a comment/ }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText('M')).toBeNull();
  expect(screen.queryByText('View discussion')).toBeNull();
});

it('opens the thread from the newest comment card', () => {
  const message: MessageListItem = {
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
  const root: MessageListItem = {
    id: 'root',
    parent: { type: 'initiative', id: 'project' },
    sender_id: 'member',
    content: 'Root comment',
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
    mentions: [],
    attachments: [],
    reactions: [],
    state: {
      root_id: 'root',
      user_id: 'member',
      anchor: null,
      resolved: false,
      created_at: '',
      updated_at: '',
    },
    thread: { reply_count: 2, preview: [], latest_reply_at: null },
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
  expect(screen.queryByText('Add a comment')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View discussion' }));
  expect(open).toHaveBeenCalledOnce();

  setMessage({
    ...message(),
    state: { ...root.state, deleted_at: '2026-10-02T12:00:00Z' },
  });
  expect(screen.getByText('Add a comment')).toBeTruthy();
  expect(screen.queryByText('View discussion')).toBeNull();
});
