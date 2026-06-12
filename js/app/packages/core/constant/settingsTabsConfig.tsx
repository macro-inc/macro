import { useFeatureFlag } from '@app/lib/analytics/posthog';
import BugIcon from '@phosphor/bug.svg';
import DeviceMobileIcon from '@phosphor/device-mobile-speaker.svg';
import KeyboardIcon from '@phosphor/keyboard.svg';
import PaintBucketIcon from '@phosphor/paint-bucket.svg';
import PlugIcon from '@phosphor/plug.svg';
import UserIconPhosphor from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { type Component, createMemo } from 'solid-js';
import { useHasPermission } from '../context/user';
import { isNativeMobilePlatform } from '../mobile/isNativeMobilePlatform';
import { isTouchDevice } from '../mobile/isTouchDevice';
import {
  DEV_MODE_ENV,
  ENABLE_APP_STORE_QR_CODE,
  ENABLE_TEAMS_OVERRIDE,
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
      { tab: 'Appearance', label: 'Appearance', icon: PaintBucketIcon },
      { tab: 'Account', label: 'Account', icon: UserIconPhosphor },
      { tab: 'Mobile App', label: 'Mobile App', icon: DeviceMobileIcon },
      { tab: 'Shortcuts', label: 'Shortcuts', icon: KeyboardIcon },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { tab: 'Team', label: 'Team', icon: UsersThreeIcon },
      { tab: 'Agent', label: 'MCPs', icon: PlugIcon },
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
  const teamsFlag = useFeatureFlag('enable-teams-settings', {
    enabledOverride: ENABLE_TEAMS_OVERRIDE,
  });
  const hasAdminPanel = useHasPermission(PERMISSION_IDS.WRITE_ADMIN_PANEL);

  return (tab: SettingsTab): boolean => {
    switch (tab) {
      case 'Appearance':
      case 'Account':
        return true;
      case 'Team':
        return teamsFlag().enabled;
      case 'Shortcuts':
        return !isTouchDevice();
      case 'Mobile App':
        return ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform();
      case 'Agent':
        return !isNativeMobilePlatform();
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
