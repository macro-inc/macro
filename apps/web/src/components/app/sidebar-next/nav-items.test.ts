import { describe, expect, it } from 'vitest';
import { moreMenuItems, type NavItemGates, visibleNavItems } from './nav-items';

const defaultGates: NavItemGates = {
  showCalendar: true,
  showCustomers: true,
  showReminders: true,
  showCalls: true,
  showReviews: true,
};

describe('reminders navigation item', () => {
  it('exposes the canonical list destination only while enabled', () => {
    const enabled = visibleNavItems({
      ...defaultGates,
      showReminders: true,
    });
    const disabled = visibleNavItems({
      ...defaultGates,
      showReminders: false,
    });

    expect(enabled.find((item) => item.id === 'reminders')).toMatchObject({
      label: 'Reminders',
      href: '/reminders',
    });
    expect(disabled.some((item) => item.id === 'reminders')).toBe(false);
  });
});

describe('calls and reviews navigation items', () => {
  it('shows calls in more menu when not pinned', () => {
    const items = moreMenuItems({
      ...defaultGates,
      showCalls: true,
      pinnedItems: undefined,
    });

    expect(items.find((item) => item.id === 'calls')).toMatchObject({
      label: 'Calls',
      href: '/calls',
    });
  });

  it('shows reviews in more menu when not pinned', () => {
    const items = moreMenuItems({
      ...defaultGates,
      showReviews: true,
      pinnedItems: undefined,
    });

    expect(items.find((item) => item.id === 'reviews')).toMatchObject({
      label: 'Reviews',
      href: '/reviews',
    });
  });

  it('hides calls from more menu when pinned', () => {
    const items = moreMenuItems({
      ...defaultGates,
      showCalls: true,
      pinnedItems: new Set(['calls']),
    });

    expect(items.find((item) => item.id === 'calls')).toBeUndefined();
  });

  it('shows pinned calls in main nav', () => {
    const items = visibleNavItems({
      ...defaultGates,
      showCalls: true,
      pinnedItems: new Set(['calls']),
    });

    expect(items.find((item) => item.id === 'calls')).toMatchObject({
      label: 'Calls',
      href: '/calls',
    });
  });
});
