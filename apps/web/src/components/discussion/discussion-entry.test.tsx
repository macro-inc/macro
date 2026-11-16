import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
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
    screen.getByRole('button', { name: /Latest project update.*2 comments/ })
  );
  expect(open).toHaveBeenCalledOnce();
});
