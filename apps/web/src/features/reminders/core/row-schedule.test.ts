import type { ReminderEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { emailReminderScheduleLabel } from './row-schedule';

const now = Date.parse('2026-10-01T12:00:00Z');
const reminder: ReminderEntity = {
  type: 'reminder',
  id: 'test',
  name: 'Review',
  description: 'Review',
  ownerId: '',
  enabled: true,
  scheduleType: 'once',
  nextRunAt: '2026-10-02T13:00:00Z',
};

describe('email workflow clock labels', () => {
  it.each([
    ['archiving', 'Scheduling return:', true],
    ['pending', 'Returning:', true],
    ['returning', 'Returning to inbox:', false],
    ['returned', 'Returned:', false],
  ] as const)(
    'labels %s honestly even while disabled',
    (state, prefix, conditional) => {
      const label = emailReminderScheduleLabel(
        {
          ...reminder,
          enabled: false,
          emailFollowup: {
            state,
            condition: 'if_no_reply',
            linkId: 'link',
            threadId: 'thread',
            revision: 'revision',
            reminderId: reminder.id,
            remindAt: '2026-10-02T13:00:00Z',
          },
        },
        now,
        'UTC'
      );
      expect(label.startsWith(prefix)).toBe(true);
      expect(label.includes('if no reply')).toBe(conditional);
      expect(label).not.toContain('Paused');
    }
  );
});
