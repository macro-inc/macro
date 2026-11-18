import { describe, expect, it } from 'vitest';
import { phoneMenuPattern } from './phone-menu-pattern';

describe('phoneMenuPattern', () => {
  it('keeps fixed short lists inline', () => {
    expect(phoneMenuPattern('call')).toBe('inline');
    expect(phoneMenuPattern('visibility')).toBe('inline');
    expect(phoneMenuPattern('reminders', { count: 5 })).toBe('inline');
  });
  it('requires both a short calendar list and single-line labels', () => {
    expect(phoneMenuPattern('calendar', { count: 5, labelsFit: true })).toBe(
      'inline'
    );
    expect(phoneMenuPattern('calendar', { count: 6, labelsFit: true })).toBe(
      'page'
    );
    expect(phoneMenuPattern('calendar', { count: 2, labelsFit: false })).toBe(
      'page'
    );
    expect(phoneMenuPattern('calendar', { count: 2 })).toBe('page');
  });
  it('keeps long, searchable, and multi-step content on pages', () => {
    for (const menu of [
      'repeat',
      'custom-repeat',
      'time-zone',
      'people',
    ] as const)
      expect(phoneMenuPattern(menu, { count: 2 })).toBe('page');
    expect(phoneMenuPattern('reminders', { count: 6 })).toBe('page');
  });
});
