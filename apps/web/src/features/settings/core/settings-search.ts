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
  /** The nav group holding the page, so `General` reads as `Team · General`. */
  group: string;
};

// Targets are the visible SettingsSection/SettingsRow labels, not DOM selectors.
// Keep individual controls here so finding a setting doesn't require its page name.
const SETTINGS: Setting[] = [
  {
    tab: 'CRM',
    title: 'Stages',
    target: 'Stages',
    keywords: 'company deal pipeline reorder rename status sales',
  },
  {
    tab: 'CRM',
    title: 'Team CRM',
    target: 'Team CRM',
    keywords: 'enable disable customers contacts companies team',
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
    tab: 'Calendar',
    title: 'Next meeting countdown',
    target: 'Next meeting countdown',
    keywords: 'sidebar badge upcoming meeting minutes now timer hide',
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
    tab: 'Harness',
    title: 'Run agents on this computer',
    keywords:
      'local runtime macrod this computer machine claude code codex desktop daemon',
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
    title: 'Interface language',
    target: 'Language',
    // The word for "language" in each interface language, so people can find
    // it in their own.
    keywords:
      'translate translation locale team personal sprache langue idioma lingua taal språk sprog kieli język язык 言語 언어 语言 語言 भाषा bahasa ngôn ngữ ภาษา',
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
    tab: 'Team Members',
    title: 'Invite people',
    keywords: 'invite add teammates coworkers colleagues email join team',
  },
  {
    tab: 'Team Members',
    title: 'Member roles',
    keywords: 'admin owner permissions remove users team',
  },
  {
    tab: 'Team Members',
    title: 'Pending invites',
    target: 'Pending invites',
    keywords: 'invitations cancel resend copy link team',
  },
  {
    tab: 'Team Members',
    title: 'Auto-join on domain',
    target: 'Auto-join on domain',
    keywords: 'email workspace membership automatic',
  },
  {
    tab: 'Team Members',
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
  // Integrations rows are targeted by name.
  {
    tab: 'Connected',
    title: 'Gmail',
    target: 'Gmail',
    keywords: 'email google workspace inbox calendar connect account',
  },
  {
    tab: 'Connected',
    title: 'Outlook',
    target: 'Outlook',
    keywords: 'email microsoft 365 inbox calendar connect account',
  },
  {
    tab: 'Connected',
    title: 'GitHub',
    target: 'GitHub',
    keywords:
      'connect integration repository pull request code app install team',
  },
  {
    tab: 'Connected',
    title: 'Slack',
    target: 'Slack',
    keywords: 'chat messages channels agent tools mcp connect',
  },
  {
    tab: 'Connected',
    title: 'Import from Slack',
    target: 'Slack',
    keywords: 'slack export channels messages history team',
  },
  {
    tab: 'Connected',
    title: 'Linear',
    target: 'Linear',
    keywords: 'issues tasks projects agent tools mcp connect import',
  },
  {
    tab: 'Connected',
    title: 'Notion',
    target: 'Notion',
    keywords: 'pages wikis docs agent tools mcp connect import',
  },
  {
    tab: 'Connected',
    title: 'Granola',
    target: 'Granola',
    keywords: 'meetings notes transcripts calls import',
  },
  {
    tab: 'Connected',
    title: 'Claude Code, Codex, and ChatGPT',
    target: 'Claude Code, Codex, and ChatGPT',
    keywords: 'ai apps mcp ide setup',
  },
  {
    tab: 'Connected',
    title: 'Coding agents on your computer',
    target: 'Coding agents on your computer',
    keywords: 'local harness hermes openclaw desktop stream sessions',
  },
  {
    tab: 'Connected',
    title: 'Custom MCP server',
    keywords: 'add mcp server url integration',
  },
  {
    tab: 'Connected',
    title: 'Agent apps and tools',
    keywords:
      'mcp integration connect external services catalog airtable trello jira asana google drive dropbox',
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
    tab: 'Desktop App',
    title: 'Desktop app version and download',
    keywords: 'download mac macos linux version latest release updated',
  },
  {
    tab: 'Mobile App',
    title: 'Mobile app version and download',
    keywords: 'download phone ios android qr code version build bundle',
  },
];

/**
 * Lowercased words with Latin accents stripped. Any script counts, so a label
 * in the interface language (German, Japanese, Hindi) is searchable too.
 */
function words(value: string): string[] {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
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
  const pages = groups.flatMap((group) =>
    group.items.map((page) => ({ page, group: group.label }))
  );
  const entries = pages.flatMap(({ page, group }) => [
    {
      id: page.tab,
      tab: page.tab,
      title: page.label,
      keywords: page.keywords.join(' '),
      page,
      group,
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
      group,
    })),
  ]);
  return entries
    .map((entry) => {
      const titleWords = words(entry.title);
      // The English label keeps English searches working in any language.
      const otherWords = words(
        `${entry.keywords} ${entry.page.label} ${entry.page.englishLabel}`
      );
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
