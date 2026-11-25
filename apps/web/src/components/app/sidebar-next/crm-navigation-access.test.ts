import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useMobileDockViews } from '../mobile/mobile-dock-views';
import { customizableNavItems } from './nav-items';
import { useNavItemGates } from './use-nav-item-gates';

const state = vi.hoisted(() => ({ allowed: (): boolean => true }));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => state.allowed(),
}));
vi.mock('@app/features/activity/use-activity-feed-flag', () => ({
  useActivityFeedFlag: () => () => true,
}));
vi.mock(
  '@app/features/notifications-inbox/use-unified-notifications-flag',
  () => ({ useUnifiedNotificationsFlag: () => () => true })
);
vi.mock('@app/features/suggestions/use-suggestions-flag', () => ({
  useSuggestionsFlag: () => () => true,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team' } },
  }),
}));
vi.mock('./use-sidebar-prefs', () => ({
  useSidebarPrefs: () => ({ prefs: () => ({ hidden: new Set(), order: [] }) }),
}));

it('reactively removes CRM from desktop navigation and the phone dock for a denied member', () => {
  createRoot((dispose) => {
    const [allowed, setAllowed] = createSignal(true);
    state.allowed = allowed;
    const gates = useNavItemGates();
    const mobile = useMobileDockViews();
    expect(
      customizableNavItems(gates()).some((item) => item.id === 'companies')
    ).toBe(true);
    expect(mobile().some((item) => item.id === 'companies')).toBe(true);
    setAllowed(false);
    expect(
      customizableNavItems(gates()).some((item) => item.id === 'companies')
    ).toBe(false);
    expect(mobile().some((item) => item.id === 'companies')).toBe(false);
    expect(mobile().some((item) => item.id === 'calendar')).toBe(true);
    setAllowed(true);
    expect(
      customizableNavItems(gates()).some((item) => item.id === 'companies')
    ).toBe(true);
    dispose();
  });
});
