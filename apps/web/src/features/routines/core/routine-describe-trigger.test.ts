import { describe, expect, it } from 'vitest';
import {
  describeTrigger,
  newScheduleTrigger,
  triggerKind,
} from './routine-triggers';

const weekly = (daysOfWeek: string[]) => ({
  ...newScheduleTrigger('week'),
  daysOfWeek,
  time: '09:00',
});
const cron = (expression: string) => ({
  ...newScheduleTrigger('custom'),
  cron: expression,
});

describe('describeTrigger', () => {
  it('reads weekly days the way people say them', () => {
    expect(describeTrigger(weekly(['2', '3', '4', '5', '6']))).toBe(
      'Weekdays at 9:00 AM'
    );
    expect(describeTrigger(weekly(['2']))).toBe('Mondays at 9:00 AM');
    expect(describeTrigger(weekly(['6', '2', '4']))).toBe(
      'Mon, Wed and Fri at 9:00 AM'
    );
    expect(describeTrigger(weekly(['7', '1']))).toBe('Weekends at 9:00 AM');
  });

  it('describes plain cron schedules written through the API', () => {
    expect(describeTrigger(cron('0 0 9 * * 2-6'))).toBe('Weekdays at 9:00 AM');
    expect(describeTrigger(cron('0 0 16 * * FRI'))).toBe('Fridays at 4:00 PM');
    expect(describeTrigger(cron('0 30 8 1 * *'))).toBe(
      'Monthly on the 1st at 8:30 AM'
    );
    expect(describeTrigger(cron('0 0 * * * *'))).toBe('Every hour');
    // Anything else stays as written.
    expect(describeTrigger(cron('0 0 */2 * * 1-5'))).toBe(
      'Custom schedule (0 0 */2 * * 1-5)'
    );
  });

  it('names events without a prefix, with the kind for their icon', () => {
    const email = {
      id: 'e',
      kind: 'event' as const,
      events: ['email.message_received' as const],
    };
    expect(describeTrigger(email)).toBe('New email received');
    expect(triggerKind(email)).toBe('email');
    expect(triggerKind(weekly(['2']))).toBe('schedule');
  });
});
