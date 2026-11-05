import { describe, expect, it } from 'vitest';
import {
  customizableNavItems,
  defaultNavItem,
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
  showNotifications: true,
  showCalendar: true,
  showScheduling: true,
  showCustomers: true,
  showCalls: true,
  showReviews: true,
  showActivity: true,
  showExternal: true,
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
      'activity',
      'booking-links',
    ]);
  });

  it('starts Activity in More and keeps it absent when its flag is off', () => {
    expect(
      visibleNavItems(defaultGates()).some((item) => item.id === 'activity')
    ).toBe(false);
    expect(moreMenuItems(defaultGates())).toContainEqual(
      expect.objectContaining({ label: 'Activity', href: '/activity' })
    );

    const gates = defaultGates({
      showActivity: false,
      prefs: defaultPrefs({ hidden: new Set() }),
    });
    for (const items of [
      customizableNavItems(gates),
      visibleNavItems(gates),
      moreMenuItems(gates),
    ]) {
      expect(items.some((item) => item.id === 'activity')).toBe(false);
    }
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

  it('moves a hidden Home from the rail to the more menu', () => {
    const gates = defaultGates({
      prefs: defaultPrefs({ hidden: new Set(['home', 'tasks']) }),
    });

    expect(visibleNavItems(gates).some((item) => item.id === 'home')).toBe(
      false
    );
    expect(moreMenuItems(gates).map((item) => item.id)).toEqual([
      'home',
      'tasks',
    ]);
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

describe('External', () => {
  it('shows External on the rail when WhatsApp linking is enabled', () => {
    expect(
      visibleNavItems(defaultGates()).some((item) => item.id === 'external')
    ).toBe(true);
  });

  it('keeps External absent everywhere when its feature flag is off', () => {
    for (const hidden of [new Set<string>(), new Set(['external'])]) {
      const gates = defaultGates({
        showExternal: false,
        prefs: defaultPrefs({ hidden }),
      });
      for (const items of [
        customizableNavItems(gates),
        visibleNavItems(gates),
        moreMenuItems(gates),
      ]) {
        expect(items.some((item) => item.id === 'external')).toBe(false);
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

describe('defaultNavItem', () => {
  it('lands on Home while it is on the rail', () => {
    expect(defaultNavItem(defaultGates()).id).toBe('home');
  });

  it('lands on the first rail item when Home is hidden', () => {
    const gates = defaultGates({
      prefs: defaultPrefs({
        hidden: new Set(['home', 'tasks']),
        order: ['tasks', 'mail', 'documents'],
      }),
    });

    expect(defaultNavItem(gates).id).toBe('mail');
  });

  it('skips a first item whose feature is off', () => {
    const gates = defaultGates({
      showNotifications: false,
      prefs: defaultPrefs({ hidden: new Set(['home']) }),
    });

    expect(defaultNavItem(gates).id).toBe('documents');
  });

  it('falls back to Home when every item is hidden', () => {
    const gates = defaultGates({
      prefs: defaultPrefs({
        hidden: new Set(SIDEBAR_NEXT_NAV_ITEMS.map((item) => item.id)),
      }),
    });

    expect(defaultNavItem(gates).id).toBe('home');
  });
});
