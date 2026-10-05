import type { ReminderEntity } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailRowSchedule } from './email-row-schedule';

const openReminderComposer = vi.hoisted(() => vi.fn());
vi.mock('../reminder-composer', () => ({ openReminderComposer }));
vi.mock('../primitives/reminder-clock', () => ({
  useReminderClock: () => () => Date.parse('2026-10-01T12:00:00Z'),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens the email snooze menu without opening or completing the row', () => {
  const openThread = vi.fn();
  const rowKey = vi.fn();
  const nearest: ReminderEntity = {
    type: 'reminder',
    id: 'r',
    name: 'Reply',
    description: 'Reply',
    ownerId: 'owner',
    enabled: true,
    scheduleType: 'once',
    nextRunAt: '2026-10-02T12:00:00Z',
    referencedEntity: { type: 'email', id: 'thread' },
    emailFollowup: {
      state: 'pending',
      condition: 'if_no_reply',
      threadId: 'thread',
      reminderId: 'r',
      revision: 'revision',
      linkId: 'inbox',
      remindAt: '2026-10-02T12:00:00Z',
    },
  };
  render(() => (
    <div onClick={openThread} onKeyDown={rowKey}>
      <EmailRowSchedule reminder={{ nearest, count: 1 }} />
    </div>
  ));
  const clock = screen.getByRole('button', { name: /Returning:.*if no reply/ });
  expect(screen.queryByRole('button', { name: /Mark.*done/ })).toBeNull();
  fireEvent.keyDown(clock, { key: 'Enter' });
  expect(rowKey).not.toHaveBeenCalled();
  fireEvent.pointerDown(clock);
  fireEvent.click(clock);
  expect(openThread).not.toHaveBeenCalled();
  expect(openReminderComposer).toHaveBeenCalledExactlyOnceWith({
    type: 'email',
    id: 'thread',
    name: 'Reply',
  });
});
