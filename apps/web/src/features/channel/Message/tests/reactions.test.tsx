/**
 * @vitest-environment jsdom
 */

import type { MessageData } from '@core/messages/types';
import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatReactorNames } from '../ReactionChip';
import { Reactions } from '../Reactions';
import { Root } from '../Root';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
}));

vi.mock('@core/user', () => ({
  idToDisplayName: (id: string) => id.replace('macro|', ''),
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

  it('dims a reaction the current user already added', () => {
    render(() => (
      <Root
        message={{
          ...baseMessage,
          reactions: [
            { emoji: '❤️', users: ['user-1', 'user-2'] },
            { emoji: '👍', users: ['user-3'] },
          ],
        }}
        actions={{
          onReact: () => undefined,
        }}
      >
        <Reactions />
      </Root>
    ));

    const chips = () =>
      screen
        .getAllByRole('button')
        .filter((el) => el.hasAttribute('data-message-reaction-chip'));
    const heart = chips().find((el) => el.dataset.emoji === '❤️');
    const thumb = chips().find((el) => el.dataset.emoji === '👍');

    expect(heart?.hasAttribute('data-user-reacted')).toBe(true);
    expect(heart?.className).toContain(
      'bg-[color-mix(in_oklch,oklch(0_0_0)_16%,var(--color-control))]'
    );
    expect(thumb?.hasAttribute('data-user-reacted')).toBe(false);
    expect(thumb?.className).not.toContain(
      'bg-[color-mix(in_oklch,oklch(0_0_0)_16%,var(--color-control))]'
    );
  });

  it('calls onReact with chip emoji when a reaction chip is clicked', async () => {
    const user = userEvent.setup({ skipHover: true });
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

    const chip = screen
      .getAllByRole('button', { name: /😂/u })
      .find((el) => el.hasAttribute('data-message-reaction-chip'))!;
    await user.click(chip);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact.mock.calls[0]?.[0]?.message?.id).toBe('message-1');
    expect(onReact.mock.calls[0]?.[0]?.emoji).toBe('😂');
  });
});

describe('formatReactorNames', () => {
  it('returns empty string for empty input', () => {
    expect(formatReactorNames([], 'user-1')).toBe('');
  });

  it('shows "You" when only the current user reacted', () => {
    expect(formatReactorNames(['user-1'], 'user-1')).toBe('You');
  });

  it('shows the display name for a single other user', () => {
    expect(formatReactorNames(['macro|alice@test.com'], 'user-1')).toBe(
      'alice@test.com'
    );
  });

  it('joins two users with "and"', () => {
    expect(
      formatReactorNames(['user-1', 'macro|alice@test.com'], 'user-1')
    ).toBe('You and alice@test.com');
  });

  it('uses Oxford comma for three or more users', () => {
    expect(
      formatReactorNames(
        ['user-1', 'macro|alice@test.com', 'macro|bob@test.com'],
        'user-1'
      )
    ).toBe('You, alice@test.com, and bob@test.com');
  });

  it('handles no current user match', () => {
    expect(
      formatReactorNames(
        ['macro|alice@test.com', 'macro|bob@test.com'],
        'other-user'
      )
    ).toBe('alice@test.com and bob@test.com');
  });

  it('puts current user first regardless of input order', () => {
    expect(
      formatReactorNames(['macro|alice@test.com', 'user-1'], 'user-1')
    ).toBe('You and alice@test.com');

    expect(
      formatReactorNames(
        ['macro|alice@test.com', 'macro|bob@test.com', 'user-1'],
        'user-1'
      )
    ).toBe('You, alice@test.com, and bob@test.com');
  });
});
