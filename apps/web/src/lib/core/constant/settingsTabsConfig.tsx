import { useFeatureFlag } from '@app/lib/analytics/posthog';
import BotIcon from '@icon/wide-bot.svg';
import BellIcon from '@phosphor/bell-simple.svg';
import BugIcon from '@phosphor/bug.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CpuIcon from '@phosphor/cpu.svg';
import CreditCardIcon from '@phosphor/credit-card.svg';
import DeviceMobileIcon from '@phosphor/device-mobile-speaker.svg';
import KeyboardIcon from '@phosphor/keyboard.svg';
import PlugIcon from '@phosphor/plug.svg';
import SwatchesIcon from '@phosphor/swatches.svg';
import TagIcon from '@phosphor/tag-simple.svg';
import UserIconPhosphor from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { type Component, createMemo } from 'solid-js';
import { useHasPermission } from '../context/user';
import { isNativeMobilePlatform } from '../mobile/isNativeMobilePlatform';
import { isTouchDevice } from '../mobile/isTouchDevice';
import {
  BOT_MANAGEMENT_FLAG,
  BOT_MANAGEMENT_OVERRIDE,
  DEV_MODE_ENV,
  ENABLE_APP_STORE_QR_CODE,
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
  ENABLE_NOTIFICATION_SETTINGS_FLAG,
  ENABLE_NOTIFICATION_SETTINGS_OVERRIDE,
} from './featureFlags';
import { PERMISSION_IDS } from './permissions';
import type { SettingsTab } from './SettingsState';

export type SettingsTabItem = {
  tab: SettingsTab;
  label: string;
  icon: Component<{ class?: string; triggerAnimation?: boolean }>;
};

export type SettingsTabGroup = {
  label: string;
  items: SettingsTabItem[];
};

/**
 * Single source of truth for the settings categories: ordering, labels, icons
 * and grouping. Consumed by the settings panel's side nav (and bottom tabs) and
 * the app sidebar's settings dropdown. Group order also defines keyboard nav
 * order (see `flatTabs` in {@link useSettingsTabs}).
 *
 * Presentation-free and hook-free: gating lives in {@link useSettingsTabAvailable}.
 */
export const SETTINGS_TAB_GROUPS: SettingsTabGroup[] = [
  {
    label: 'General',
    items: [
      { tab: 'Account', label: 'Account', icon: UserIconPhosphor },
      { tab: 'Notifications', label: 'Notifications', icon: BellIcon },
      { tab: 'Billing', label: 'Billing', icon: CreditCardIcon },
      { tab: 'Appearance', label: 'Appearance', icon: SwatchesIcon },
      { tab: 'Mobile App', label: 'Mobile App', icon: DeviceMobileIcon },
      { tab: 'Shortcuts', label: 'Shortcuts', icon: KeyboardIcon },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { tab: 'Team', label: 'Team', icon: UsersThreeIcon },
      { tab: 'Tags', label: 'Tags', icon: TagIcon },
      { tab: 'CRM', label: 'CRM', icon: BuildingsIcon },
      {
        tab: 'Connected',
        label: 'Connections',
        icon: CpuIcon,
      },
      { tab: 'Agent', label: 'MCP server', icon: PlugIcon },
      { tab: 'Bots', label: 'Bots', icon: BotIcon },
    ],
  },
  {
    label: 'Admin',
    items: [{ tab: 'Admin', label: 'Debug', icon: BugIcon }],
  },
];

/** Flattened view of {@link SETTINGS_TAB_GROUPS} for direct tab lookups. */
const SETTINGS_TAB_ITEMS = SETTINGS_TAB_GROUPS.flatMap((group) => group.items);

/**
 * URL slugs for each settings tab, used to build the settings page path
 * (`/settings/<slug>`, and the `settings/<slug>` pair when docked in a split).
 * Kept separate from labels so we can rename a tab's UI label without breaking
 * existing/bookmarked URLs.
 */
const SETTINGS_TAB_SLUGS: Record<SettingsTab, string> = {
  Account: 'account',
  Notifications: 'notifications',
  Billing: 'billing',
  Subscription: 'subscription',
  Organization: 'organization',
  Appearance: 'appearance',
  Mobile: 'mobile',
  'AI Memory': 'ai-memory',
  Inbox: 'inbox',
  Shortcuts: 'shortcuts',
  'Mobile App': 'mobile-app',
  Agent: 'mcp-server',
  Bots: 'bots',
  Team: 'team',
  Tags: 'tags',
  CRM: 'crm',
  Connected: 'connections',
  Email: 'email',
  GitHub: 'github',
  Admin: 'admin',
};

const SETTINGS_SLUG_TO_TAB = new Map<string, SettingsTab>(
  (Object.entries(SETTINGS_TAB_SLUGS) as [SettingsTab, string][]).map(
    ([tab, slug]) => [slug, tab]
  )
);

/** The URL slug for a settings tab (e.g. `Connected` → `connections`). */
export const settingsTabToSlug = (tab: SettingsTab): string =>
  SETTINGS_TAB_SLUGS[tab];

/** Resolve a URL slug back to its settings tab, or `undefined` if unknown. */
export const settingsSlugToTab = (
  slug: string | null | undefined
): SettingsTab | undefined =>
  slug ? SETTINGS_SLUG_TO_TAB.get(slug) : undefined;

/**
 * Look up a single tab's presentation (label + icon). Lets consumers that
 * surface individual tabs (e.g. the sidebar's quick links) reuse the config's
 * label/icon instead of hardcoding their own.
 */
export const getSettingsTabItem = (
  tab: SettingsTab
): SettingsTabItem | undefined =>
  SETTINGS_TAB_ITEMS.find((item) => item.tab === tab);

/**
 * Returns a predicate gating which settings tabs are available given feature
 * flags and platform. This is the single gate that the settings panel and the
 * app sidebar both rely on — keep tab rendering guarded by it so we never
 * surface a tab the panel won't render.
 */
export const useSettingsTabAvailable = () => {
  const botManagementFlag = useFeatureFlag(BOT_MANAGEMENT_FLAG, {
    enabledOverride: BOT_MANAGEMENT_OVERRIDE,
  });
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
  const notificationSettingsFlag = useFeatureFlag(
    ENABLE_NOTIFICATION_SETTINGS_FLAG,
    {
      enabledOverride: ENABLE_NOTIFICATION_SETTINGS_OVERRIDE,
    }
  );
  const hasAdminPanel = useHasPermission(PERMISSION_IDS.WRITE_ADMIN_PANEL);

  return (tab: SettingsTab): boolean => {
    switch (tab) {
      case 'Appearance':
      case 'Account':
      case 'Billing':
        return true;
      case 'Notifications':
        return notificationSettingsFlag().enabled;
      case 'Team':
      case 'Tags':
        return true;
      // CRM is still rolling out (Macro-internal only); keep the settings tab
      // behind the same enable-crm gate as every other CRM surface so it never
      // leaks into teams that can't actually use the CRM.
      case 'CRM':
        return crmFlag().enabled;
      case 'Connected':
        return true;
      case 'Shortcuts':
        return !isTouchDevice();
      case 'Mobile App':
        return ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform();
      case 'Agent':
        return !isNativeMobilePlatform();
      case 'Bots':
        return botManagementFlag().enabled;
      case 'Mobile':
        return isNativeMobilePlatform() && DEV_MODE_ENV;
      case 'Admin':
        return hasAdminPanel();
      default:
        return false;
    }
  };
};

/**
 * Reactive view of the settings tabs: groups filtered to the currently
 * available tabs (empty groups dropped), plus a flattened ordered list for
 * keyboard navigation and the mobile bottom tabs.
 */
export const useSettingsTabs = () => {
  const isAvailable = useSettingsTabAvailable();

  const groups = createMemo<SettingsTabGroup[]>(() =>
    SETTINGS_TAB_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) => isAvailable(item.tab)),
    })).filter((group) => group.items.length > 0)
  );

  const flatTabs = createMemo<SettingsTabItem[]>(() =>
    groups().flatMap((group) => group.items)
  );

  return { groups, flatTabs, isAvailable };
};
