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

/** A leading `in:<view>` followed by a space is the field's filter chip. */
const LEADING_FILTER = /^in:(\S+)\s/i;

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

/** The field's chip and the text typed after it. */
export function splitEmailSearchField(text: string): {
  scope?: EmailSearchScopeId;
  text: string;
} {
  const leading = LEADING_FILTER.exec(text);
  const value = leading?.[1]?.toLowerCase();
  if (!leading || !value || !isEmailSearchScopeId(value)) return { text };

  return { scope: value, text: text.slice(leading[0].length) };
}

/**
 * What typing `typed` after the chip makes of the search. A view's whole
 * name typed as `in:<view>` becomes the chip at once, replacing the one there,
 * so the field never holds a filter the chip does not show. No view's name
 * starts another's, so a whole name is never one still being typed.
 */
export function editEmailSearchField(
  scope: EmailSearchScopeId | undefined,
  typed: string
): string {
  let chip = scope;
  let moved = false;
  const text = typed.replace(
    /(?<=^|\s)in:(\S+)(?:\s|$)/gi,
    (whole, value: string) => {
      const id = value.toLowerCase();
      if (!isEmailSearchScopeId(id)) return whole;

      chip = id;
      moved = true;
      return '';
    }
  );

  return formatEmailSearch(chip, moved ? text : typed);
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
