/**
 * @vitest-environment jsdom
 */

import userEvent from '@testing-library/user-event';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { Root } from './Root';
import { Reactions } from './Reactions';
import type { MessageData } from './types';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
}));

const baseMessage: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-2',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

describe('Reactions', () => {
  it('does not render row when there are no reactions', () => {
    const { container } = render(() => (
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
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull();
  });

  it('renders styled reaction chips and add-reaction button when reactions exist', () => {
    const { container } = render(() => (
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
    const chip = screen.getByRole('button', { name: /👍/u });
    const addButton = screen.getByRole('button', { name: 'Add reaction' });

    expect(row).not.toBeNull();
    expect(chip).not.toBeNull();
    expect(chip.className).toContain('border-accent');
    expect(chip.textContent).toContain('2');
    expect(addButton).not.toBeNull();
  });

  it('calls onReact with chip emoji when a reaction chip is clicked', async () => {
    const user = userEvent.setup();
    const onReact = vi.fn();

    render(() => (
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

    const chip = screen.getByRole('button', { name: /😂/u });
    await user.click(chip);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact.mock.calls[0]?.[0]?.message?.id).toBe('message-1');
    expect(onReact.mock.calls[0]?.[0]?.emoji).toBe('😂');
  });
});
