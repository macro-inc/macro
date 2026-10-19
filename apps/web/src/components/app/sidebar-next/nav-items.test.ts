import { describe, expect, it } from 'vitest';
import {
  customizableNavItems,
  moreMenuItems,
  type NavItemGates,
  orderNavItems,
  SIDEBAR_NEXT_NAV_ITEMS,
  visibleNavItems,
} from './nav-items';
import { DEFAULT_HIDDEN_IDS, type SidebarPrefs } from './use-sidebar-prefs';

const defaultPrefs = (overrides: Partial<SidebarPrefs> = {}): SidebarPrefs => ({
  hidden: new Set(DEFAULT_HIDDEN_IDS),
  order: [],
  ...overrides,
});

const defaultGates = (overrides: Partial<NavItemGates> = {}): NavItemGates => ({
  showCalendar: true,
  showScheduling: true,
  showCustomers: true,
  showCalls: true,
  showReviews: true,
  prefs: defaultPrefs(),
  ...overrides,
});

it('keeps reminders inside Email instead of offering a separate app', () => {
  const items = visibleNavItems(defaultGates());
  expect(items.some((item) => item.id === 'reminders')).toBe(false);
  expect(items.some((item) => item.id === 'mail')).toBe(true);
});

describe('sidebar visibility preferences', () => {
  it('hides calls and reviews from the rail by default', () => {
    const items = visibleNavItems(defaultGates());

    expect(items.some((item) => item.id === 'calls')).toBe(false);
    expect(items.some((item) => item.id === 'reviews')).toBe(false);
    expect(items.some((item) => item.id === 'home')).toBe(true);
    expect(items.some((item) => item.id === 'tasks')).toBe(true);
  });

  it('puts default-hidden items in the more menu', () => {
    const items = moreMenuItems(defaultGates());

    expect(items.map((item) => item.id)).toEqual([
      'calls',
      'reviews',
      'booking-links',
    ]);
  });

  it('shows an item on the rail when it is not hidden', () => {
    const items = visibleNavItems(
      defaultGates({
        prefs: defaultPrefs({ hidden: new Set(['reviews']) }),
      })
    );

    expect(items.find((item) => item.id === 'calls')).toMatchObject({
      label: 'Calls',
      href: '/calls',
    });
    expect(items.some((item) => item.id === 'reviews')).toBe(false);
  });

  it('never hides home from the rail', () => {
    const items = visibleNavItems(
      defaultGates({
        prefs: defaultPrefs({ hidden: new Set(['home', 'tasks']) }),
      })
    );

    expect(items.some((item) => item.id === 'home')).toBe(true);
    expect(items.some((item) => item.id === 'tasks')).toBe(false);
  });

  it('lists shown and hidden items in the customize menu', () => {
    const items = customizableNavItems(defaultGates());

    expect(items.some((item) => item.id === 'home')).toBe(true);
    expect(items.some((item) => item.id === 'calls')).toBe(true);
    expect(items.some((item) => item.id === 'reviews')).toBe(true);
  });

  it('offers Scheduling for customization and moves it between More and the rail', () => {
    expect(
      customizableNavItems(defaultGates()).find(
        (item) => item.id === 'booking-links'
      )
    ).toMatchObject({
      label: 'Scheduling',
      href: '/scheduling',
    });
    expect(
      visibleNavItems(defaultGates()).some(
        (item) => item.id === 'booking-links'
      )
    ).toBe(false);
    const gates = defaultGates({
      prefs: defaultPrefs({
        hidden: new Set(['calls', 'reviews']),
        order: ['booking-links', 'tasks'],
      }),
    });
    expect(
      visibleNavItems(gates)
        .map((item) => item.id)
        .slice(0, 3)
    ).toEqual(['home', 'booking-links', 'tasks']);
    expect(
      moreMenuItems(gates).some((item) => item.id === 'booking-links')
    ).toBe(false);
  });

  it('keeps Scheduling absent everywhere when its feature flag is off', () => {
    for (const hidden of [new Set<string>(), new Set(DEFAULT_HIDDEN_IDS)]) {
      const gates = defaultGates({
        showScheduling: false,
        prefs: defaultPrefs({ hidden }),
      });
      for (const items of [
        customizableNavItems(gates),
        visibleNavItems(gates),
        moreMenuItems(gates),
      ]) {
        expect(items.some((item) => item.id === 'booking-links')).toBe(false);
      }
    }
  });
});

describe('orderNavItems', () => {
  it('keeps home first and applies a custom order', () => {
    const ordered = orderNavItems(SIDEBAR_NEXT_NAV_ITEMS, [
      'tasks',
      'mail',
      'home',
      'documents',
    ]);

    expect(ordered.map((item) => item.id).slice(0, 4)).toEqual([
      'home',
      'tasks',
      'mail',
      'documents',
    ]);
  });
});
