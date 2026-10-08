import { describe, expect, it } from 'vitest';
import {
  newEventType,
  newSchedule,
  validateEvent,
  validateSchedule,
} from './types';

describe('scheduling form validation', () => {
  it('rejects overlapping hours and allows adjacent windows', () => {
    const schedule = newSchedule('America/New_York');
    schedule.weekly[1].windows = [
      { start: '09:00', end: '12:00' },
      { start: '11:00', end: '17:00' },
    ];
    expect(validateSchedule(schedule)).toContain('overlap');
    schedule.weekly[1].windows[1].start = '12:00';
    expect(validateSchedule(schedule)).toBeUndefined();
  });
  it('rejects duplicate links and fractional booking durations', () => {
    const event = {
      ...newEventType('schedule', ['host'], false),
      title: 'Meeting',
      slug: 'meeting',
    };
    expect(validateEvent(event, [{ ...event, id: 'another' }])).toContain(
      'link'
    );
    expect(validateEvent({ ...event, durationMinutes: 30.5 }, [])).toContain(
      'Duration'
    );
    expect(validateEvent(event, [])).toBeUndefined();
  });
});
