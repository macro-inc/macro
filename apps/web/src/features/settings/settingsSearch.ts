import type { SettingsTab } from '@core/constant/SettingsState';
import type { SettingsTabItem } from '@core/constant/settingsTabsConfig';

/*
 * Search index for the settings sidebar. Two kinds of entries:
 *
 *   - page entries: one per available settings tab (its sidebar label plus
 *     generous synonyms — "dark mode" finds Appearance, "payment" finds Billing)
 *   - inner entries: sections, rows and integrations that live *inside* a page
 *     and aren't visible from the sidebar (Gmail, Linear, "Delete account", …)
 *
 * The content below is hand-curated and English-only. Keywords should be what a
 * user would plausibly type, not what the UI happens to call the thing — err on
 * the side of adding more.
 */

/** Something inside a settings page that can be found by search. */
type SettingsSearchItem = {
  /** Shown as the result title, e.g. "Gmail" or "Delete account". */
  title: string;
  /** The section it lives in, shown in the result's breadcrumb. */
  section?: string;
  keywords?: readonly string[];
};

type SettingsSearchContent = {
  /** Synonyms for the page itself. */
  keywords: readonly string[];
  items: readonly SettingsSearchItem[];
};

const SETTINGS_SEARCH_CONTENT: Partial<
  Record<SettingsTab, SettingsSearchContent>
> = {
  Account: {
    keywords: [
      'profile',
      'me',
      'my account',
      'user',
      'personal',
      'identity',
      'login',
      'sign in',
    ],
    items: [
      {
        title: 'Profile picture',
        section: 'Profile',
        keywords: ['avatar', 'photo', 'image', 'upload picture', 'headshot'],
      },
      {
        title: 'Name',
        section: 'Profile',
        keywords: [
          'first name',
          'last name',
          'full name',
          'display name',
          'rename',
        ],
      },
      {
        title: 'Email address',
        section: 'Profile',
        keywords: ['email', 'account email', 'login email', 'change email'],
      },
      {
        title: 'App version',
        keywords: [
          'version',
          'update',
          'app update',
          'build',
          'release',
          'upgrade app',
        ],
      },
      {
        title: 'Delete account',
        section: 'Danger zone',
        keywords: [
          'remove account',
          'close account',
          'deactivate',
          'erase',
          'gdpr',
        ],
      },
    ],
  },
  'API Keys': {
    keywords: [
      'api',
      'api key',
      'keys',
      'token',
      'tokens',
      'access token',
      'personal access token',
      'secret',
      'credentials',
      'developer',
      'scripts',
      'ci',
      'programmatic access',
      'sdk',
      'automation',
    ],
    items: [
      {
        title: 'Your keys',
        keywords: [
          'create key',
          'new key',
          'generate key',
          'delete key',
          'revoke key',
          'rotate key',
        ],
      },
    ],
  },
  Notifications: {
    keywords: [
      'alerts',
      'notify',
      'push',
      'badges',
      'unread',
      'sounds',
      'do not disturb',
      'dnd',
    ],
    items: [
      {
        title: 'Email digest',
        section: 'Delivery',
        keywords: ['digest', 'summary email', 'daily email', 'unread email'],
      },
      {
        title: 'Inbox notifications',
        section: 'Delivery',
        keywords: ['inbox', 'always on'],
      },
      {
        title: 'Muted items',
        keywords: ['mute', 'unmute', 'silence', 'quiet', 'snooze'],
      },
    ],
  },
  Billing: {
    keywords: [
      'payment',
      'subscription',
      'plan',
      'pricing',
      'price',
      'invoice',
      'receipt',
      'credit card',
      'upgrade',
      'downgrade',
      'cancel subscription',
      'premium',
      'free plan',
      'pro',
      'seats',
      'trial',
      'money',
      'pay',
    ],
    items: [
      {
        title: 'Current plan',
        keywords: [
          'premium plan',
          'free plan',
          'upgrade',
          'manage subscription',
        ],
      },
    ],
  },
  Appearance: {
    keywords: [
      'theme',
      'themes',
      'dark mode',
      'light mode',
      'colors',
      'colour',
      'look',
      'style',
      'display',
      'ui',
      'visual',
      'skin',
    ],
    items: [
      {
        title: 'Color theme',
        keywords: [
          'dark theme',
          'light theme',
          'dark mode',
          'light mode',
          'night mode',
          'active theme',
          'system theme',
          'custom theme',
          'edit theme',
          'copy theme',
          'accent color',
          'background',
        ],
      },
      {
        title: 'Monochrome icons',
        section: 'Interface',
        keywords: [
          'icons',
          'icon color',
          'grayscale',
          'greyscale',
          'interface',
        ],
      },
    ],
  },
  'Mobile App': {
    keywords: [
      'phone',
      'ios',
      'iphone',
      'ipad',
      'android',
      'app store',
      'play store',
      'download app',
      'qr code',
      'install',
      'mobile',
    ],
    items: [],
  },
  Shortcuts: {
    keywords: [
      'keyboard',
      'keyboard shortcuts',
      'hotkeys',
      'keybindings',
      'key bindings',
      'keys',
      'commands',
      'cheat sheet',
    ],
    items: [
      {
        title: 'Screencast keys',
        keywords: ['show keys', 'key overlay', 'presentation', 'demo'],
      },
    ],
  },
  Team: {
    keywords: [
      'workspace',
      'organization',
      'org',
      'company',
      'members',
      'people',
      'users',
      'colleagues',
      'teammates',
      'invite',
      'admin',
      'owner',
    ],
    items: [
      {
        title: 'Members',
        keywords: [
          'people',
          'users',
          'remove member',
          'roles',
          'permissions',
          'admins',
          'owner',
          'seats',
          'teammates',
        ],
      },
      {
        title: 'Invitations',
        keywords: [
          'invite',
          'invite people',
          'pending invites',
          'members can invite',
          'auto-join on domain',
          'domain',
          'join',
          'add people',
          'email invite',
        ],
      },
      {
        title: 'Team name',
        section: 'General',
        keywords: ['rename team', 'workspace name', 'company name'],
      },
      {
        title: 'Team slug',
        section: 'General',
        keywords: [
          'slug',
          'task prefix',
          'task references',
          'ticket prefix',
          'eng-42',
        ],
      },
      {
        title: 'Default link sharing',
        section: 'General',
        keywords: [
          'sharing',
          'link sharing scope',
          'share links',
          'public links',
          'permissions',
        ],
      },
      {
        title: 'GitHub App',
        section: 'Connections',
        keywords: [
          'github',
          'repositories',
          'repos',
          'pull requests',
          'pr sync',
          'autolink',
          'github autolink',
          'source control',
        ],
      },
    ],
  },
  Tags: {
    keywords: ['labels', 'label', 'categories', 'tagging', 'organize'],
    items: [
      {
        title: 'Personal tags',
        keywords: ['my tags', 'private tags'],
      },
      {
        title: 'Team tags',
        keywords: ['shared tags', 'share with team', 'workspace tags'],
      },
    ],
  },
  CRM: {
    keywords: [
      'customers',
      'customer relationship',
      'sales',
      'deals',
      'pipeline',
      'stages',
      'companies',
      'contacts',
      'leads',
      'accounts',
    ],
    items: [
      {
        title: 'Enable or disable CRM',
        section: 'General',
        keywords: ['turn off crm', 'disable crm', 'enable crm'],
      },
    ],
  },
  Connected: {
    keywords: [
      'connected accounts',
      'integrations',
      'integration',
      'connect',
      'accounts',
      'apps',
      'services',
      'link account',
      'third party',
      'oauth',
      'sync',
      'plugins',
      'extensions',
      'tools',
    ],
    items: [
      {
        title: 'Gmail',
        section: 'Accounts',
        keywords: [
          'google',
          'google account',
          'google workspace',
          'email',
          'email account',
          'mail',
          'inbox',
          'add inbox',
          'connect email',
          'calendar',
          'calendar sync',
          'google calendar',
          'force sync',
          'signature',
          'email signature',
          'primary inbox',
          'shared inbox',
        ],
      },
      {
        title: 'GitHub',
        section: 'Accounts',
        keywords: [
          'git',
          'github account',
          'connect github',
          'repositories',
          'repos',
          'pull requests',
          'code',
        ],
      },
      {
        title: 'MCP integrations',
        keywords: [
          'mcp',
          'mcp servers',
          'model context protocol',
          'add server',
          'custom server',
          'agent tools',
          'ai tools',
          'connectors',
          'pipedream',
        ],
      },
      {
        title: 'Linear',
        section: 'MCP integrations',
        keywords: ['issues', 'tickets', 'project management'],
      },
      {
        title: 'Slack',
        section: 'MCP integrations',
        keywords: ['chat', 'messaging', 'channels'],
      },
      {
        title: 'Notion',
        section: 'MCP integrations',
        keywords: ['notes', 'wiki', 'docs', 'pages'],
      },
      {
        title: 'PostHog',
        section: 'MCP integrations',
        keywords: ['analytics', 'product analytics', 'events'],
      },
      {
        title: 'Datadog',
        section: 'MCP integrations',
        keywords: ['monitoring', 'observability', 'logs', 'metrics'],
      },
      {
        title: 'Grafana',
        section: 'MCP integrations',
        keywords: ['dashboards', 'monitoring', 'observability', 'metrics'],
      },
      {
        title: 'Cursor',
        section: 'Coding sessions',
        keywords: [
          'coding agent',
          'coding sessions',
          'code agent',
          'ide',
          'default model',
          'ai model',
          'background agent',
          'programming',
        ],
      },
    ],
  },
  Agent: {
    keywords: [
      'mcp',
      'mcp server',
      'macro mcp',
      'model context protocol',
      'agent',
      'agents',
      'ai',
      'assistant',
      'claude',
      'claude code',
      'codex',
      'chatgpt',
      'ide',
      'api',
      'connect agent',
      'external agents',
      'setup',
      'developer',
    ],
    items: [],
  },
  Bots: {
    keywords: [
      'bot',
      'webhooks',
      'webhook',
      'automation',
      'automations',
      'integrations',
      'api',
      'teammates',
      'channels',
    ],
    items: [
      {
        title: 'Your bots',
        keywords: [
          'create bot',
          'new bot',
          'webhook url',
          'bot channels',
          'credentials',
        ],
      },
    ],
  },
  Agents: {
    keywords: [
      'agent',
      'ai agents',
      'custom agent',
      'create agent',
      'assistants',
      'personas',
      'mentions',
      'mention',
      'bots',
      'system prompt',
      'instructions',
    ],
    items: [
      {
        title: 'Team agents',
        keywords: ['shared agents', 'workspace agents', 'macro agent'],
      },
      {
        title: 'Private agents',
        keywords: ['my agents', 'personal agents', 'own agents'],
      },
      {
        title: 'Agent profile',
        section: 'Profile',
        keywords: ['avatar', 'agent name', 'tag', 'handle', 'identity'],
      },
      {
        title: 'System prompt',
        section: 'Behavior',
        keywords: [
          'instructions',
          'prompt',
          'persona',
          'behavior',
          'behaviour',
        ],
      },
      {
        title: 'Agent channels',
        section: 'Channels',
        keywords: [
          'all channels',
          'specific channels',
          'channel access',
          'where the agent can be mentioned',
          'global agent',
        ],
      },
      {
        title: 'Agent runtime',
        section: 'Runtime',
        keywords: ['harness', 'model', 'ai model', 'which model', 'runtime'],
      },
    ],
  },
  Harness: {
    keywords: [
      'agent runtime',
      'runtime',
      'runtimes',
      'bring your own agent',
      'byoa',
      'connected agents',
      'models',
      'sandbox',
      'compute',
      'execution',
      'infrastructure',
      'in-memory',
    ],
    items: [
      {
        title: 'Bring your own agent',
        keywords: [
          'connect agent',
          'custom runtime',
          'external harness',
          'remove harness',
        ],
      },
    ],
  },
  Admin: {
    keywords: [
      'debug',
      'developer',
      'internal',
      'staff',
      'feature flags',
      'flags',
      'experimental',
      'advanced',
    ],
    items: [
      {
        title: 'Persist list filters',
        keywords: ['filters', 'soup filters', 'remember filters', 'reload'],
      },
    ],
  },
};

/** One searchable thing: a settings page, or a section/row/integration inside one. */
export type SettingsSearchEntry = {
  tab: SettingsTab;
  /** The page's sidebar label. */
  page: string;
  /** Result title: the page label for page entries, the item title otherwise. */
  title: string;
  /** Breadcrumb for inner entries (e.g. "MCP integrations"); never set on pages. */
  section?: string;
  /** True for the entry representing the page itself. */
  isPage: boolean;
  keywords: readonly string[];
};

export type SettingsSearchResult = {
  entry: SettingsSearchEntry;
  /** Lower is a better match. */
  score: number;
};

/**
 * Build the search index from the *currently available* tabs, so gating
 * (feature flags, platform, permissions) carries over to search for free — we
 * never surface a page the panel won't render.
 */
export function buildSettingsSearchIndex(
  tabs: readonly SettingsTabItem[]
): SettingsSearchEntry[] {
  return tabs.flatMap((item) => {
    const content = SETTINGS_SEARCH_CONTENT[item.tab];
    const page: SettingsSearchEntry = {
      tab: item.tab,
      page: item.label,
      title: item.label,
      isPage: true,
      keywords: content?.keywords ?? [],
    };
    const inner = (content?.items ?? []).map(
      (inner): SettingsSearchEntry => ({
        tab: item.tab,
        page: item.label,
        title: inner.title,
        section: inner.section,
        isPage: false,
        keywords: inner.keywords ?? [],
      })
    );
    return [page, ...inner];
  });
}

/** Lowercase, fold accents, and drop anything that isn't a letter or digit. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether two strings are within one edit (insert, delete, substitute, or
 * adjacent transposition) of each other — enough to forgive a typo without
 * matching unrelated words.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true;
  // Same length: one substitution or one transposition.
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return (
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  // Lengths differ by one: a single insertion/deletion.
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

// Match quality per query token, best (lowest) first. Exact word hits on the
// title beat hits buried in keywords, which beat prefixes, which beat fuzzy.
const EXACT_TITLE = 0;
const EXACT_ANY = 1;
const PREFIX_TITLE = 2;
const PREFIX_ANY = 3;
const SUBSTRING = 4;
const TYPO = 5;

/** Minimum token length before we forgive a typo — short words have too many neighbours. */
const TYPO_MIN_LENGTH = 4;

type IndexedEntry = {
  entry: SettingsSearchEntry;
  titleWords: string[];
  allWords: string[];
  /** Every phrase with its spaces removed, so "darkmode" still finds "dark mode". */
  compactPhrases: string[];
};

function indexEntry(entry: SettingsSearchEntry): IndexedEntry {
  const titleWords = tokenize(entry.title);
  const phrases = [
    entry.title,
    entry.page,
    entry.section ?? '',
    ...entry.keywords,
  ];
  const allWords = Array.from(new Set(phrases.flatMap(tokenize)));
  const compactPhrases = phrases
    .map((p) => tokenize(p).join(''))
    .filter(Boolean);
  return { entry, titleWords, allWords, compactPhrases };
}

function scoreToken(token: string, indexed: IndexedEntry): number | undefined {
  if (indexed.titleWords.includes(token)) return EXACT_TITLE;
  if (indexed.allWords.includes(token)) return EXACT_ANY;
  if (indexed.titleWords.some((w) => w.startsWith(token))) return PREFIX_TITLE;
  if (indexed.allWords.some((w) => w.startsWith(token))) return PREFIX_ANY;
  if (indexed.compactPhrases.some((p) => p.includes(token))) return SUBSTRING;
  if (
    token.length >= TYPO_MIN_LENGTH &&
    indexed.allWords.some((w) => isTypoOf(token, w))
  ) {
    return TYPO;
  }
  return undefined;
}

/**
 * Whether `token` looks like a typo of `word` or of a prefix of it, so
 * "conection" still finds "connections". People almost never mistype the first
 * letter, so it has to agree — that keeps "gmail" from matching "email".
 */
function isTypoOf(token: string, word: string): boolean {
  if (token[0] !== word[0]) return false;
  if (withinOneEdit(token, word)) return true;
  // A dropped, extra or swapped letter shifts the prefix length by up to one.
  for (const length of [token.length - 1, token.length, token.length + 1]) {
    if (length < word.length && withinOneEdit(token, word.slice(0, length))) {
      return true;
    }
  }
  return false;
}

/**
 * Rank the index against a free-text query. Every word of the query has to
 * match somewhere in an entry (title, page, section or keywords) for it to be
 * returned; matching is case-insensitive, prefix-tolerant, substring-tolerant
 * and forgives a single typo in longer words. Results are ordered best match
 * first, with page entries ahead of inner entries on ties and the index order
 * (sidebar order) as the final tie-break.
 */
export function searchSettings(
  query: string,
  entries: readonly SettingsSearchEntry[]
): SettingsSearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results: SettingsSearchResult[] = [];
  entries.forEach((entry) => {
    const indexed = indexEntry(entry);
    let score = 0;
    for (const token of tokens) {
      const tokenScore = scoreToken(token, indexed);
      if (tokenScore === undefined) return;
      score += tokenScore;
    }
    results.push({ entry, score });
  });

  return results
    .map((result, order) => ({ result, order }))
    .sort((a, b) => {
      if (a.result.score !== b.result.score)
        return a.result.score - b.result.score;
      if (a.result.entry.isPage !== b.result.entry.isPage) {
        return a.result.entry.isPage ? -1 : 1;
      }
      return a.order - b.order;
    })
    .map(({ result }) => result);
}
