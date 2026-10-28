/** @vitest-environment jsdom */

import type { Bot } from '@service-storage/generated/schemas/bot';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { ChannelBotRow } from './ChannelBotRow';

vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Avatar')),
  ...(await import('@ui/components/Badge')),
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/Item')),
}));

const bot: Bot = {
  id: 'bot-1',
  name: 'Helper',
  handle: 'helper',
  description: 'Helps the team',
  kind: 'owned',
  has_agent: false,
  created_at: '2026-10-05T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
};

it('opens from the row and keyboard, while keeping copy and remove separate', () => {
  const onOpen = vi.fn();
  const onCopyWebhook = vi.fn();
  const onRemove = vi.fn();
  render(() => (
    <ChannelBotRow
      bot={bot}
      editable
      removing={false}
      onOpen={onOpen}
      onCopyWebhook={onCopyWebhook}
      onRemove={onRemove}
    />
  ));

  const link = screen.getByRole('link', { name: 'Open Helper' });
  const secondary = screen.getByText('@helper · Helps the team');
  expect(link.contains(secondary)).toBe(true);
  fireEvent.click(secondary);
  fireEvent.keyDown(link, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledTimes(2);

  const copy = screen.getByRole('button', { name: 'Copy webhook URL' });
  const remove = screen.getByRole('button', { name: 'Remove Helper' });
  expect(link.contains(copy)).toBe(false);
  expect(link.contains(remove)).toBe(false);
  fireEvent.click(copy);
  fireEvent.click(remove);
  expect(onCopyWebhook).toHaveBeenCalledOnce();
  expect(onRemove).toHaveBeenCalledOnce();
  expect(onOpen).toHaveBeenCalledTimes(2);
});
