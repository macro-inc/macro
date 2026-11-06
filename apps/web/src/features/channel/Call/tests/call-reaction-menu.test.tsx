import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CallReactionMenu,
  CallReactionRow,
} from '../CallControls/CallReactionMenu';

afterEach(cleanup);
it('moves across the reaction row with arrows and sends on Enter', async () => {
  const send = vi.fn();
  render(() => <CallReactionRow onReaction={send} />);
  const first = screen.getByRole('button', { name: '👍' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = screen.getByRole('button', { name: '👏' });
  expect(document.activeElement).toBe(second);
  await userEvent.setup().keyboard('{Enter}');
  expect(send).toHaveBeenCalledWith('👏');
  fireEvent.keyDown(second, { key: 'Home' });
  expect(document.activeElement).toBe(first);
});
it('keeps the quick picker open for repeated sends and closes on Escape', async () => {
  const send = vi.fn();
  render(() => <CallReactionMenu onReaction={send} onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  await screen.findByRole('dialog', { name: 'Reactions' });
  fireEvent.click(screen.getByRole('button', { name: '👍' }));
  fireEvent.click(screen.getByRole('button', { name: '🎉' }));
  expect(send.mock.calls).toEqual([['👍'], ['🎉']]);
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
