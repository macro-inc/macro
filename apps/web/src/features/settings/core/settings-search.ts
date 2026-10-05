import type { SettingsTab } from '@core/constant/SettingsState';
import type {
  SettingsTabGroup,
  SettingsTabItem,
} from '@core/constant/settingsTabsConfig';
import { NOTIFICATION_EVENT_GROUPS } from '../../notifications/notification-event-catalog';
import { settingsTarget } from './settings-target';

type Setting = {
  tab: SettingsTab;
  title: string;
  target?: string;
  keywords: string;
};
export type SettingsSearchResult = Setting & {
  id: string;
  page: SettingsTabItem;
};

// Targets are the visible SettingsSection/SettingsRow labels, not DOM selectors.
// Keep individual controls here so finding a setting doesn't require its page name.
const SETTINGS: Setting[] = [
  {
    tab: 'CRM',
    title: 'Deal stages',
    target: 'Deal stages',
    keywords: 'pipeline reorder status closed stages sales',
  },
  {
    tab: 'CRM',
    title: 'Enable CRM',
    target: 'General',
    keywords: 'disable customers contacts companies team',
  },
  {
    tab: 'Shortcuts',
    title: 'Search and command menu shortcuts',
    target: 'Core',
    keywords: 'keyboard hotkeys find create settings chat',
  },
  {
    tab: 'Shortcuts',
    title: 'Split navigation shortcuts',
    target: 'Splits',
    keywords: 'keyboard hotkeys back forward panel close',
  },
  {
    tab: 'Shortcuts',
    title: 'List and email shortcuts',
    target: 'Unified List',
    keywords: 'keyboard hotkeys select read unread delete preview',
  },

  ...NOTIFICATION_EVENT_GROUPS.flatMap((group) =>
    group.events.map((event) => ({
      tab: 'Notifications' as const,
      title: `${event.label} · ${group.label}`,
      target: group.label,
      keywords: `${group.label} ${event.description}`,
    }))
  ),
  {
    tab: 'Email',
    title: 'Email accounts',
    target: 'Accounts',
    keywords: 'gmail connect add inbox sync reconnect remove',
  },
  {
    tab: 'Email',
    title: 'Email signatures',
    target: 'Signatures',
    keywords: 'signature footer signoff formatting image replies forwards',
  },
  {
    tab: 'Calendar',
    title: 'Connected calendars',
    target: 'Connected calendars',
    keywords:
      'google gmail connect accounts visibility show hide color colour subcalendar',
  },
  {
    tab: 'Booking links',
    title: 'Booking links',
    target: 'Booking links',
    keywords: 'event types meeting duration scheduling public link',
  },
  {
    tab: 'Booking links',
    title: 'Availability',
    target: 'Availability',
    keywords: 'working hours timezone schedule time zone',
  },
  {
    tab: 'Booking links',
    title: 'Booking page',
    target: 'Booking pages',
    keywords: 'public profile scheduling name username',
  },
  {
    tab: 'Booking links',
    title: 'Bookings',
    target: 'Bookings',
    keywords: 'upcoming past cancel reschedule meetings',
  },
  {
    tab: 'Booking links',
    title: 'Scheduling teams',
    target: 'Teams',
    keywords: 'members collective round robin',
  },
  {
    tab: 'Booking links',
    title: 'Scheduling insights',
    target: 'Insights',
    keywords: 'analytics statistics',
  },
  {
    tab: 'Agents',
    title: 'Team agents',
    target: 'Team agents',
    keywords: 'shared ai assistant configure',
  },
  {
    tab: 'Agents',
    title: 'Private agents',
    target: 'Private agents',
    keywords: 'personal ai assistant configure',
  },
  {
    tab: 'Harness',
    title: 'Agent runtimes and credentials',
    keywords: 'cursor harness runtime api key provider pairing daemon',
  },
  {
    tab: 'Account',
    title: 'Profile picture',
    target: 'Profile',
    keywords: 'avatar photo image',
  },
  {
    tab: 'Account',
    title: 'Name and email address',
    target: 'Profile',
    keywords: 'first last profile account',
  },
  {
    tab: 'Account',
    title: 'Delete account',
    target: 'Delete account',
    keywords: 'remove close deletion',
  },
  {
    tab: 'Appearance',
    title: 'Color theme',
    target: 'Color Theme',
    keywords: 'dark light system mode custom colour',
  },
  {
    tab: 'Appearance',
    title: 'Monochrome icons',
    target: 'Monochrome icons',
    keywords: 'color colourful sidebar',
  },
  {
    tab: 'Appearance',
    title: 'Show tooltips',
    target: 'Show tooltips',
    keywords: 'hover hints help',
  },
  {
    tab: 'Notifications',
    title: 'Notification delivery',
    target: 'Delivery',
    keywords: 'push desktop browser mobile alerts permissions',
  },
  {
    tab: 'Notifications',
    title: 'Email digest',
    target: 'Email digest',
    keywords: 'summary notification daily mail',
  },
  {
    tab: 'Notifications',
    title: 'Snoozed items',
    target: 'Snoozed items',
    keywords: 'pause resume notifications',
  },
  {
    tab: 'Notifications',
    title: 'Muted items',
    target: 'Muted items',
    keywords: 'unmute silence notifications',
  },
  {
    tab: 'Billing',
    title: 'Plan and payment',
    target: 'Subscription',
    keywords: 'subscription invoice billing credit card cancel manage upgrade',
  },
  {
    tab: 'Billing',
    title: 'AI usage',
    target: 'AI usage',
    keywords: 'limits quota tokens credits consumption',
  },
  {
    tab: 'Team',
    title: 'Team name and URL',
    target: 'General',
    keywords: 'workspace slug rename',
  },
  {
    tab: 'Team',
    title: 'Members',
    target: 'Members',
    keywords: 'invite users role permissions remove workspace team',
  },
  {
    tab: 'Team',
    title: 'Pending invites',
    target: 'Pending invites',
    keywords: 'invitations cancel resend',
  },
  {
    tab: 'Team',
    title: 'Auto-join on domain',
    target: 'Auto-join on domain',
    keywords: 'email workspace membership automatic',
  },
  {
    tab: 'Team',
    title: 'Members can invite',
    target: 'Members can invite',
    keywords: 'permissions invitation',
  },
  {
    tab: 'Team',
    title: 'Default link sharing',
    target: 'Default link sharing',
    keywords: 'access public private permission',
  },
  {
    tab: 'Team',
    title: 'Team GitHub connection',
    target: 'Connections',
    keywords: 'repository app install integration',
  },
  {
    tab: 'Tags',
    title: 'Personal tags',
    target: 'Personal',
    keywords: 'label organize category',
  },
  {
    tab: 'Tags',
    title: 'Team tags',
    target: 'Team',
    keywords: 'shared label workspace category',
  },
  {
    tab: 'Connected',
    title: 'GitHub account',
    target: 'Accounts',
    keywords: 'connect integration repository pull request',
  },
  {
    tab: 'Connections',
    title: 'Agent apps and tools',
    keywords: 'mcp integration connect external services',
  },
  {
    tab: 'Agent',
    title: 'Connect to the Macro MCP server',
    keywords: 'claude chatgpt external client url setup',
  },
  {
    tab: 'API Keys',
    title: 'Create and revoke API keys',
    keywords: 'token secret developer authentication',
  },
  {
    tab: 'Mobile App',
    title: 'Get the mobile app',
    keywords: 'download phone ios android qr code',
  },
];

function words(value: string): string[] {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]+/g) ?? []
  );
}

/** One insertion, deletion, substitution, or adjacent transposition. */
function isNearWord(a: string, b: string): boolean {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  }
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

function tokenScore(query: string, candidate: string): number {
  if (query === candidate) return 12;
  if (candidate.startsWith(query)) return 9;
  if (query.length >= 3 && candidate.includes(query)) return 6;
  if (
    isNearWord(query, candidate) ||
    (candidate.endsWith('s') && isNearWord(query, candidate.slice(0, -1)))
  )
    return 4;
  return 0;
}

export function searchSettings(
  groups: readonly SettingsTabGroup[],
  query: string,
  options: { emailSignatures?: boolean } = {}
): SettingsSearchResult[] {
  const tokens = words(query);
  if (!tokens.length) return [];
  const pages = groups.flatMap((group) => group.items);
  const entries = pages.flatMap((page) => [
    {
      id: page.tab,
      tab: page.tab,
      title: page.label,
      keywords: page.keywords.join(' '),
      page,
    },
    ...SETTINGS.filter(
      (setting) =>
        setting.tab === page.tab &&
        (options.emailSignatures !== false ||
          setting.title !== 'Email signatures')
    ).map((setting) => ({
      ...setting,
      target: settingsTarget(setting.target),
      id: `${page.tab}:${setting.title}`,
      page,
    })),
  ]);
  return entries
    .map((entry) => {
      const titleWords = words(entry.title);
      const otherWords = words(`${entry.keywords} ${entry.page.label}`);
      const scores = tokens.map((token) =>
        Math.max(
          0,
          ...titleWords.map((word) => tokenScore(token, word) * 2),
          ...otherWords.map((word) => tokenScore(token, word))
        )
      );
      const score = scores.every(Boolean)
        ? scores.reduce((a, b) => a + b, 0)
        : 0;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}
