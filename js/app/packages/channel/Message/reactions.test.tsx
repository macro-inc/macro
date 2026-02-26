/**
 * @vitest-environment jsdom
 */

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Root } from './Root';
import { Reactions } from './Reactions';
import type { MessageData } from './types';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
}));

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

const baseMessage: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-2',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Reactions', () => {
  it('does not render row when there are no reactions', () => {
    const { container, cleanup } = renderComponent(() => (
      <Root
        message={{
          ...baseMessage,
          reactions: [],
        }}
        actions={{
          onReact: () => undefined,
        }}
      >
        <Reactions />
      </Root>
    ));

    expect(container.querySelector('[data-message-reactions-row]')).toBeNull();
    expect(container.querySelector('[data-message-reaction-add]')).toBeNull();
    cleanup();
  });

  it('renders styled reaction chips and add-reaction button when reactions exist', () => {
    const { container, cleanup } = renderComponent(() => (
      <Root
        message={{
          ...baseMessage,
          reactions: [{ emoji: '👍', users: ['user-1', 'user-3'] }],
        }}
        actions={{
          onReact: () => undefined,
        }}
      >
        <Reactions />
      </Root>
    ));

    const row = container.querySelector('[data-message-reactions-row]');
    const chip = container.querySelector(
      '[data-message-reaction-chip][data-emoji="👍"]'
    ) as HTMLButtonElement | null;
    const addButton = container.querySelector(
      '[data-message-reaction-add]'
    ) as HTMLButtonElement | null;

    expect(row).not.toBeNull();
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain('border-accent');
    expect(chip?.textContent).toContain('2');
    expect(addButton).not.toBeNull();
    cleanup();
  });

  it('calls onReact with chip emoji when a reaction chip is clicked', () => {
    const onReact = vi.fn();

    const { container, cleanup } = renderComponent(() => (
      <Root
        message={{
          ...baseMessage,
          reactions: [{ emoji: '😂', users: ['user-3'] }],
        }}
        actions={{
          onReact,
        }}
      >
        <Reactions />
      </Root>
    ));

    const chip = container.querySelector(
      '[data-message-reaction-chip][data-emoji="😂"]'
    ) as HTMLButtonElement | null;
    expect(chip).not.toBeNull();

    chip?.click();
    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact.mock.calls[0]?.[0]?.message?.id).toBe('message-1');
    expect(onReact.mock.calls[0]?.[0]?.emoji).toBe('😂');
    cleanup();
  });
});
