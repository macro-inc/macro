import { describe, expect, it } from 'vitest';
import {
  nextNotificationState,
  notificationStateFromGraphql,
  notificationStatesForFilter,
} from '../notification-state';

describe('notification filter intent', () => {
  it('preserves the complete domain transition table', () => {
    for (const before of ['unseen', 'seen', 'done'] as const) {
      expect(nextNotificationState(before, 'MARK_SEEN')).toBe(
        before === 'unseen' ? 'seen' : before
      );
      expect(nextNotificationState(before, 'MARK_DONE')).toBe('done');
      expect(nextNotificationState(before, 'MARK_UNDONE')).toBe(
        before === 'done' ? 'seen' : before
      );
    }
    expect(notificationStateFromGraphql('UNSEEN')).toBe('unseen');
    expect(notificationStateFromGraphql('SEEN')).toBe('seen');
    expect(notificationStateFromGraphql('DONE')).toBe('done');
  });
  it('uses state unions for active and acknowledged filters', () => {
    expect(notificationStatesForFilter('done', false)).toEqual([
      'unseen',
      'seen',
    ]);
    expect(notificationStatesForFilter('done', true)).toEqual(['done']);
    expect(notificationStatesForFilter('seen', false)).toEqual(['unseen']);
    expect(notificationStatesForFilter('seen', true)).toEqual(['seen', 'done']);
  });

  it('rejects malformed persisted intent instead of broadening the query', () => {
    expect(() => notificationStatesForFilter('done', 'false')).toThrow();
    expect(() => notificationStatesForFilter('seen', undefined)).toThrow();
  });
});
