/** @vitest-environment jsdom */

import type { ChannelParticipant } from '@queries/channel/types';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ParticipantsListItem } from './ParticipantsListItem';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>Avatar</span>,
}));

vi.mock('@core/user', () => ({
  getDisplayName: () => 'Alex Smith',
  idToEmail: () => 'alex@example.com',
  tryMacroId: (id: string) => id,
}));

vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Badge')),
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/Item')),
}));

const participant: ChannelParticipant = {
  channel_id: 'channel',
  user_id: 'macro|alex@example.com',
  joined_at: '2026-10-05T00:00:00Z',
  role: 'member',
};

function setup(overrides: Partial<ChannelParticipant> = {}) {
  const onClick = vi.fn();
  const onRemove = vi.fn();
  render(() => (
    <ParticipantsListItem
      participant={{ ...participant, ...overrides }}
      currentUserId="macro|me@example.com"
      editable
      onClick={onClick}
      onRemove={onRemove}
    />
  ));
  return { onClick, onRemove };
}

describe('ParticipantsListItem', () => {
  it('links the avatar, name, email, and role to the DM', () => {
    const { onClick } = setup();
    const link = screen.getByRole('link', { name: 'Message Alex Smith' });
    for (const text of ['Avatar', 'Alex Smith', 'alex@example.com', 'Member']) {
      const target = screen.getByText(text);
      expect(link.contains(target)).toBe(true);
      fireEvent.click(target, { shiftKey: true });
    }
    expect(onClick).toHaveBeenCalledTimes(4);
    expect(onClick.mock.calls[0][0].shiftKey).toBe(true);
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(5);
  });

  it('keeps removal outside the DM link', () => {
    const { onClick, onRemove } = setup();
    const remove = screen.getByRole('button', { name: 'Remove participant' });
    expect(screen.getByRole('link').contains(remove)).toBe(false);
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps owner removal disabled', () => {
    const { onClick, onRemove } = setup({ role: 'owner' });
    const remove = screen.getByRole('button', {
      name: 'Cannot remove participant',
    });
    expect(remove.hasAttribute('disabled')).toBe(true);
    fireEvent.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
