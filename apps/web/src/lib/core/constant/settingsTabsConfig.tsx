import { useFeatureFlag } from '@app/lib/analytics/posthog';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import BugIcon from '@icon/system/regular/bug.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CpuIcon from '@icon/system/regular/cpu.svg';
import CreditCardIcon from '@icon/system/regular/credit-card.svg';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import DeviceMobileIcon from '@icon/system/regular/device-mobile-speaker.svg';
import EmailIcon from '@icon/system/regular/envelope-simple.svg';
import GaugeIcon from '@icon/system/regular/gauge.svg';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import KeyIcon from '@icon/system/regular/key.svg';
import KeyboardIcon from '@icon/system/regular/keyboard.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PlugIcon from '@icon/system/regular/plug.svg';
import PlugsConnectedIcon from '@icon/system/regular/plugs-connected.svg';
import BotIcon from '@icon/system/regular/robot.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import SwatchesIcon from '@icon/system/regular/swatches.svg';
import TagIcon from '@icon/system/regular/tag-simple.svg';
import UserIcon from '@icon/system/regular/user.svg';
import TeamIcon from '@icon/system/regular/users-three.svg';
import { type Component, createMemo } from 'solid-js';
import { useHasPermission } from '../context/user';
import { isMobile } from '../mobile/isMobile';
import { isNativeMobilePlatform } from '../mobile/isNativeMobilePlatform';
import { isTouchDevice } from '../mobile/isTouchDevice';
import { isPlatform } from '../util/platform';
import {
  botManagement,
  DEV_MODE_ENV,
  desktopApp,
  ENABLE_APP_STORE_QR_CODE,
  ENABLE_EMAIL,
  enableCalendarScheduling,
  enableChatV3Agents,
  enableCrm,
} from './featureFlags';
import { PERMISSION_IDS } from './permissions';
import type { SettingsTab } from './SettingsState';

export type SettingsTabItem = {
  tab: SettingsTab;
  label: string;
  icon: Component<{ class?: string; triggerAnimation?: boolean }>;
  /**
   * Extra search terms for this tab. The label is always searched too.
   * Required on every nav item so the terms stay next to the tab they find.
   */
  keywords: readonly string[];
  /** Findable from search, but not a standing row in the settings nav. */
  searchOnly?: boolean;
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
 * Search keywords live on each item so the nav and the settings search share
 * one definition.
 */
export const SETTINGS_TAB_GROUPS: SettingsTabGroup[] = [
  {
    label: 'Blocks',
    items: [
      {
        tab: 'Email',
        label: 'Email',
        icon: EmailIcon,
        keywords: ['gmail', 'inbox', 'signature', 'sync'],
      },
      {
        tab: 'Calendar',
        label: 'Calendar',
        icon: CalendarIcon,
        keywords: ['google', 'accounts', 'visibility', 'colors'],
      },
      {
        tab: 'Booking links',
        label: 'Booking links',
        icon: LinkIcon,
        keywords: ['scheduling', 'bookings', 'availability', 'meetings'],
      },
      {
        tab: 'Agents',
        label: 'Agents',
        icon: AgentIcon,
        keywords: ['ai', 'assistant', 'bot'],
      },
      {
        tab: 'CRM',
        label: 'CRM',
        icon: BuildingsIcon,
        keywords: ['contacts', 'customers', 'deals'],
      },
    ],
  },
  {
    label: 'Personal',
    items: [
      {
        tab: 'Account',
        label: 'Account',
        icon: UserIcon,
        keywords: ['profile', 'user', 'email', 'name'],
      },
      {
        tab: 'Appearance',
        label: 'Appearance',
        icon: SwatchesIcon,
        keywords: ['theme', 'dark', 'light', 'color'],
      },
      {
        tab: 'Notifications',
        label: 'Notifications',
        icon: BellIcon,
        keywords: ['alerts', 'email', 'sound'],
      },
      {
        tab: 'Shortcuts',
        label: 'Keyboard shortcuts',
        icon: KeyboardIcon,
        keywords: ['keyboard', 'hotkey', 'keybinding'],
      },
      {
        tab: 'Usage',
        label: 'Usage',
        icon: GaugeIcon,
        keywords: ['ai', 'limit', 'credits', 'reload', 'usage'],
      },
      {
        tab: 'Billing',
        label: 'Billing',
        icon: CreditCardIcon,
        keywords: ['payment', 'subscription', 'invoice', 'plan'],
      },
      {
        tab: 'Desktop App',
        label: 'Desktop App',
        icon: DesktopIcon,
        keywords: ['download', 'mac', 'macos', 'linux', 'version', 'update'],
      },
      {
        tab: 'Mobile App',
        label: 'Mobile App',
        icon: DeviceMobileIcon,
        keywords: ['phone', 'ios', 'android'],
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        tab: 'Team',
        label: 'Team',
        icon: TeamIcon,
        keywords: ['members', 'users', 'workspace'],
      },
      {
        tab: 'Tags',
        label: 'Tags',
        icon: TagIcon,
        keywords: ['label', 'category'],
      },
      {
        tab: 'Connected',
        label: 'Integrations',
        icon: CpuIcon,
        keywords: ['integrations', 'apps', 'connections'],
      },
    ],
  },
  {
    label: 'Developer',
    items: [
      {
        tab: 'Connections',
        label: 'Agent connections',
        icon: PlugsConnectedIcon,
        keywords: ['agent', 'tools', 'apps', 'mcp'],
      },
      {
        tab: 'Harness',
        label: 'Runtimes',
        icon: HardDrivesIcon,
        keywords: ['cursor', 'harness', 'runtime', 'credential', 'api key'],
      },
      {
        tab: 'Agent',
        label: 'MCP server',
        icon: PlugIcon,
        keywords: ['mcp', 'server', 'protocol'],
      },
      {
        tab: 'API Keys',
        label: 'API Keys',
        icon: KeyIcon,
        keywords: ['api', 'key', 'token', 'authentication'],
      },
      {
        tab: 'Bots',
        label: 'Bots',
        icon: BotIcon,
        keywords: ['routine', 'bot'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [{ tab: 'Admin', label: 'Debug', icon: BugIcon, keywords: [] }],
  },
];

/**
 * URL slugs for each settings tab, used to build the settings page path
 * (`/settings/<slug>`, and the `settings/<slug>` pair when docked in a split).
 * Kept separate from labels so we can rename a tab's UI label without breaking
 * existing/bookmarked URLs.
 */
const SETTINGS_TAB_SLUGS: Record<SettingsTab, string> = {
  Account: 'account',
  'API Keys': 'api-keys',
  Notifications: 'notifications',
  Usage: 'usage',
  Billing: 'billing',
  Subscription: 'subscription',
  Organization: 'organization',
  Appearance: 'appearance',
  Mobile: 'mobile',
  'AI Memory': 'ai-memory',
  Inbox: 'inbox',
  Shortcuts: 'shortcuts',
  'Mobile App': 'mobile-app',
  'Desktop App': 'desktop-app',
  Agent: 'mcp-server',
  Agents: 'agents',
  Harness: 'runtimes',
  Bots: 'bots',
  Team: 'team',
  Calendar: 'calendar',
  'Booking links': 'booking-links',
  Tags: 'tags',
  CRM: 'crm',
  Connected: 'connections',
  // `connections` predates this tab and stays on Integrations for old links.
  Connections: 'agent-connections',
  Email: 'email',
  GitHub: 'github',
  Admin: 'admin',
};

const SETTINGS_SLUG_TO_TAB = new Map<string, SettingsTab>(
  (Object.entries(SETTINGS_TAB_SLUGS) as [SettingsTab, string][]).map(
    ([tab, slug]) => [slug, tab]
  )
);

// Preserve daemon pairing links and bookmarks from before the rename.
SETTINGS_SLUG_TO_TAB.set('harness', 'Harness');

/** The URL slug for a settings tab (e.g. `Connected` → `connections`). */
export const settingsTabToSlug = (tab: SettingsTab): string =>
  SETTINGS_TAB_SLUGS[tab];

/** Resolve a URL slug back to its settings tab, or `undefined` if unknown. */
export const settingsSlugToTab = (
  slug: string | null | undefined
): SettingsTab | undefined =>
  slug ? SETTINGS_SLUG_TO_TAB.get(slug) : undefined;

/**
 * Returns a predicate gating which settings tabs are available given feature
 * flags and platform. This is the single gate that the settings panel and the
 * app sidebar both rely on — keep tab rendering guarded by it so we never
 * surface a tab the panel won't render.
 */
export const useSettingsTabAvailable = () => {
  const calendarSchedulingFlag = useFeatureFlag(enableCalendarScheduling);
  const botManagementFlag = useFeatureFlag(botManagement);
  const chatV3AgentsFlag = useFeatureFlag(enableChatV3Agents);
  const crmFlag = useFeatureFlag(enableCrm);
  const desktopAppFlag = useFeatureFlag(desktopApp);
  const hasAdminPanel = useHasPermission(PERMISSION_IDS.WRITE_ADMIN_PANEL);

  return (tab: SettingsTab): boolean => {
    switch (tab) {
      case 'Appearance':
      case 'Account':
      case 'Notifications':
      case 'Usage':
      case 'Billing':
        return true;
      case 'Email':
        return ENABLE_EMAIL;
      case 'Calendar':
      case 'Booking links':
        return calendarSchedulingFlag().enabled;
      // Issuing and copying a key is desk work, and the mobile sheet has no
      // good place for a one-time secret.
      case 'API Keys':
        return !isMobile();
      case 'Team':
      case 'Tags':
        return true;
      // CRM is still rolling out (Macro-internal only); keep the settings tab
      // behind the same enable-crm gate as every other CRM surface so it never
      // leaks into teams that can't actually use the CRM.
      case 'CRM':
        return crmFlag().enabled;
      case 'Connected':
      case 'Connections':
        return true;
      case 'Shortcuts':
        return !isTouchDevice();
      case 'Mobile App':
        return ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform();
      case 'Desktop App':
        return (
          isPlatform('desktop') ||
          (isPlatform('web') && desktopAppFlag().enabled)
        );
      case 'Agent':
        return !isNativeMobilePlatform();
      // Configurable agents are still rolling out; keep both tabs behind the
      // same enable-chat-v3-agents gate as the channel mention surfaces, so
      // settings never advertises agents to a user who cannot mention one.
      case 'Harness':
      case 'Agents':
        return chatV3AgentsFlag().enabled;
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

  const searchGroups = createMemo<SettingsTabGroup[]>(() =>
    SETTINGS_TAB_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) => isAvailable(item.tab)),
    })).filter((group) => group.items.length > 0)
  );

  const groups = createMemo<SettingsTabGroup[]>(() =>
    searchGroups()
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.searchOnly),
      }))
      .filter((group) => group.items.length > 0)
  );

  const flatTabs = createMemo<SettingsTabItem[]>(() =>
    groups().flatMap((group) => group.items)
  );

  return { groups, searchGroups, flatTabs, isAvailable };
};
