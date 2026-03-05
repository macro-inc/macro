/**
 * @vitest-environment jsdom
 */

import userEvent from '@testing-library/user-event';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '../ActionMenu';
import { MessageActionsProvider } from '../context';
import { Root } from '../Root';
import type { MessageData } from '../types';

const message: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-1',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

describe('ActionMenu', () => {
  it('does not render when no actions are provided', () => {
    render(() => (
      <Root message={message}>
        <ActionMenu />
      </Root>
    ));

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders only actions that are provided', () => {
    render(() => (
      <Root
        message={message}
        actions={{
          onReply: () => undefined,
          onDelete: () => undefined,
        }}
      >
        <ActionMenu />
      </Root>
    ));

    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('uses actions from an outer provider when Root does not override', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    render(() => (
      <MessageActionsProvider
        value={{
          onEdit,
        }}
      >
        <Root message={message}>
          <ActionMenu />
        </Root>
      </MessageActionsProvider>
    ));

    const editButton = screen.getByRole('button', { name: 'Edit' });
    await user.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls provided handlers with the current message', async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    const onCopyLink = vi.fn();

    render(() => (
      <Root
        message={message}
        actions={{
          onReply,
          onCopyLink,
        }}
      >
        <ActionMenu />
      </Root>
    ));

    const replyButton = screen.getByRole('button', { name: 'Reply' });
    const copyLinkButton = screen.getByRole('button', { name: 'Copy Link' });

    await user.click(replyButton);
    await user.click(copyLinkButton);

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onReply.mock.calls[0]?.[0]?.message?.id).toBe(message.id);
    expect(onCopyLink.mock.calls[0]?.[0]?.message?.id).toBe(message.id);
  });

  it('renders quick reactions and calls onReact with selected emoji', async () => {
    const user = userEvent.setup();
    const onReact = vi.fn();

    render(() => (
      <Root
        message={message}
        actions={{
          onReact,
        }}
      >
        <ActionMenu />
      </Root>
    ));

    const quickButtons = screen.getAllByRole('button', { name: /^React /u });
    expect(quickButtons).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'More reactions' })).toBeTruthy();

    const thumbsUp = screen.getByRole('button', { name: 'React 👍' });
    await user.click(thumbsUp);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact.mock.calls[0]?.[0]?.message?.id).toBe(message.id);
    expect(onReact.mock.calls[0]?.[0]?.emoji).toBe('👍');
  });

  it('keeps hover actions visible while emoji menu is open', async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <Root
        message={message}
        actions={{
          onReact: () => undefined,
        }}
      >
        <ActionMenu />
      </Root>
    ));

    const hoverActions = container.querySelector(
      '[data-message-hover-actions]'
    ) as HTMLDivElement | null;
    const emojiMenuTrigger = screen.getByRole('button', {
      name: 'More reactions',
    });

    expect(hoverActions).not.toBeNull();
    expect(hoverActions?.className).toContain('opacity-0');

    await user.click(emojiMenuTrigger);
    expect(hoverActions?.className).toContain('opacity-100');
  });
});
