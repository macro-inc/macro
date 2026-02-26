/**
 * @vitest-environment jsdom
 */

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from './ActionMenu';
import { MessageActionsProvider } from './context';
import { Root } from './Root';
import type { MessageData } from './types';

function renderComponent(component: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(component, container);

  return {
    container,
    cleanup: () => {
      dispose();
      container.remove();
    },
  };
}

const message: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-1',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ActionMenu', () => {
  it('does not render when no actions are provided', () => {
    const { container, cleanup } = renderComponent(() => (
      <Root message={message}>
        <ActionMenu />
      </Root>
    ));

    expect(container.querySelector('[data-message-action]')).toBeNull();
    cleanup();
  });

  it('renders only actions that are provided', () => {
    const { container, cleanup } = renderComponent(() => (
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

    const buttons = container.querySelectorAll('[data-message-action]');
    expect(buttons).toHaveLength(2);
    expect(
      container.querySelector('[data-message-action="reply"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-message-action="delete"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-message-action="edit"]')).toBeNull();
    cleanup();
  });

  it('uses actions from an outer provider when Root does not override', () => {
    const onEdit = vi.fn();

    const { container, cleanup } = renderComponent(() => (
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

    const editButton = container.querySelector(
      '[data-message-action="edit"]'
    ) as HTMLButtonElement | null;
    expect(editButton).not.toBeNull();
    editButton?.click();
    expect(onEdit).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('calls provided handlers with the current message', () => {
    const onReply = vi.fn();
    const onCopyLink = vi.fn();

    const { container, cleanup } = renderComponent(() => (
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

    const replyButton = container.querySelector(
      '[data-message-action="reply"]'
    ) as HTMLButtonElement | null;
    const copyLinkButton = container.querySelector(
      '[data-message-action="copy-link"]'
    ) as HTMLButtonElement | null;

    expect(replyButton).not.toBeNull();
    expect(copyLinkButton).not.toBeNull();

    replyButton?.click();
    copyLinkButton?.click();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onReply.mock.calls[0]?.[0]?.message?.id).toBe(message.id);
    expect(onCopyLink.mock.calls[0]?.[0]?.message?.id).toBe(message.id);
    cleanup();
  });

  it('renders quick reactions and calls onReact with selected emoji', () => {
    const onReact = vi.fn();

    const { container, cleanup } = renderComponent(() => (
      <Root
        message={message}
        actions={{
          onReact,
        }}
      >
        <ActionMenu />
      </Root>
    ));

    const quickButtons = container.querySelectorAll(
      '[data-message-action="react-quick"]'
    );
    expect(quickButtons).toHaveLength(3);
    expect(
      container.querySelector('[data-message-action="react-open-menu"]')
    ).not.toBeNull();

    const thumbsUp = container.querySelector(
      '[data-message-action="react-quick"][data-emoji="👍"]'
    ) as HTMLButtonElement | null;
    expect(thumbsUp).not.toBeNull();
    thumbsUp?.click();

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact.mock.calls[0]?.[0]?.message?.id).toBe(message.id);
    expect(onReact.mock.calls[0]?.[0]?.emoji).toBe('👍');
    cleanup();
  });

  it('keeps hover actions visible while emoji menu is open', () => {
    const { container, cleanup } = renderComponent(() => (
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
    const emojiMenuTrigger = container.querySelector(
      '[data-message-action="react-open-menu"]'
    ) as HTMLButtonElement | null;

    expect(hoverActions).not.toBeNull();
    expect(emojiMenuTrigger).not.toBeNull();
    expect(hoverActions?.className).toContain('opacity-0');

    emojiMenuTrigger?.click();
    expect(hoverActions?.className).toContain('opacity-100');

    cleanup();
  });
});
