import { t } from '@app/lib/i18n';
import { EMAIL_TAB_LABELS } from '../constants';
import type { EmailTab } from '../tabs';

/**
 * The Mail views a search can be narrowed to with `in:<view>`, named as Mail
 * names them. Inbox is Focus, Signal and Noise together. Scheduled,
 * Reminders, Spam and Trash are not in the search index.
 */
export const EMAIL_SEARCH_SCOPE_IDS = [
  'inbox',
  'focus',
  'signal',
  'noise',
  'favorites',
  'sent',
  'drafts',
  'calendar',
  'shared',
  'archived',
] as const;

export type EmailSearchScopeId = (typeof EMAIL_SEARCH_SCOPE_IDS)[number];

/** The mail a search reaches: all of it, or one view. */
export type EmailSearchScope = 'all' | EmailSearchScopeId;

export type ParsedEmailSearch = {
  /** The words searched for. */
  query: string;
  /** The view the search is narrowed to, by its last `in:` filter. */
  scope?: EmailSearchScopeId;
};

const IN_FILTER = /^in:(\S*)$/i;

export const isEmailSearchScopeId = (
  value: string
): value is EmailSearchScopeId =>
  (EMAIL_SEARCH_SCOPE_IDS as readonly string[]).includes(value);

/** The views whose names start with what follows a typed `in:`. */
export const emailSearchScopesStartingWith = (prefix: string) =>
  EMAIL_SEARCH_SCOPE_IDS.filter((id) => id.startsWith(prefix.toLowerCase()));

/**
 * Splits `in:<view>` filters out of the typed search. The last view named
 * wins. An `in:` still being typed (`in:se`) is left out of the words, so the
 * search does not run on it; any other `in:` stays a word.
 */
export function parseEmailSearch(text: string): ParsedEmailSearch {
  let scope: EmailSearchScopeId | undefined;
  const words: string[] = [];

  for (const word of text.split(/\s+/)) {
    if (!word) continue;

    const value = IN_FILTER.exec(word)?.[1]?.toLowerCase();
    if (value === undefined) {
      words.push(word);
      continue;
    }

    if (isEmailSearchScopeId(value)) {
      scope = value;
      continue;
    }

    if (emailSearchScopesStartingWith(value).length > 0) continue;
    words.push(word);
  }

  return { query: words.join(' '), ...(scope ? { scope } : {}) };
}

/**
 * The search text for `query` narrowed to `scope`, with the filter first and
 * a space after it, which is how the field shows it as a chip.
 */
export function formatEmailSearch(
  scope: EmailSearchScopeId | undefined,
  query: string
): string {
  return scope ? `in:${scope} ${query}` : query;
}

/** A view's whole name in the text, with the space after it. */
const WHOLE_FILTER = /(?<=^|\s)in:(\S+)(?:\s|$)/gi;

/**
 * The field's chip and the text beside it. The chip is the view the search
 * runs in, the last one named as `parseEmailSearch` reads it, so a stored or
 * restored search can never show one view and search another; every whole
 * view name leaves the text. No view's name starts another's, so a whole
 * name is never one still being typed.
 */
export function splitEmailSearchField(text: string): {
  scope?: EmailSearchScopeId;
  text: string;
} {
  let scope: EmailSearchScopeId | undefined;
  const rest = text.replace(WHOLE_FILTER, (whole, value: string) => {
    const id = value.toLowerCase();
    if (!isEmailSearchScopeId(id)) return whole;

    scope = id;
    return '';
  });

  return scope ? { scope, text: rest } : { text };
}

/**
 * What typing `typed` beside the chip makes of the search: a view's whole
 * name typed as `in:<view>` becomes the chip at once, replacing the one there.
 */
export function editEmailSearchField(
  scope: EmailSearchScopeId | undefined,
  typed: string
): string {
  const field = splitEmailSearchField(typed);
  return formatEmailSearch(field.scope ?? scope, field.text);
}

/** The tab each view is, except Inbox, which is Focus, Signal and Noise. */
const SCOPE_TABS = {
  focus: 'focus',
  signal: 'important',
  noise: 'noise',
  favorites: 'favorites',
  sent: 'sent',
  drafts: 'drafts',
  calendar: 'calendar',
  shared: 'shared',
  archived: 'archived',
} as const satisfies Record<Exclude<EmailSearchScopeId, 'inbox'>, EmailTab>;

/**
 * The view a tab narrows a search to: All is all mail, and Scheduled,
 * Reminders, Spam and Trash are none, since the search index has none of them.
 */
export const emailSearchScopeForTab = (
  tab: EmailTab
): EmailSearchScope | undefined => {
  if (tab === 'all') return 'all';

  return EMAIL_SEARCH_SCOPE_IDS.find(
    (scope) => emailSearchScopeTab(scope) === tab
  );
};

export const emailSearchScopeTab = (
  scope: EmailSearchScopeId
): EmailTab | undefined => (scope === 'inbox' ? undefined : SCOPE_TABS[scope]);

/** The view's name, as Mail's navigation shows it. */
export const emailSearchScopeLabel = (scope: EmailSearchScopeId): string =>
  scope === 'inbox'
    ? t('viewMenus.inbox')
    : EMAIL_TAB_LABELS[SCOPE_TABS[scope]];
