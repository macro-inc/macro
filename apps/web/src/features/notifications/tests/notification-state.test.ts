import { describe, expect, it } from 'vitest';
import { notificationStatesForFilter } from '../notification-state';

describe('notification filter intent', () => {
  it('uses state unions for active and acknowledged filters', () => {
    expect(notificationStatesForFilter('done', false)).toEqual(['unseen', 'seen']);
    expect(notificationStatesForFilter('done', true)).toEqual(['done']);
    expect(notificationStatesForFilter('seen', false)).toEqual(['unseen']);
    expect(notificationStatesForFilter('seen', true)).toEqual(['seen', 'done']);
  });

  it('rejects malformed persisted intent instead of broadening the query', () => {
    expect(() => notificationStatesForFilter('done', 'false')).toThrow();
    expect(() => notificationStatesForFilter('seen', undefined)).toThrow();
  });
});
