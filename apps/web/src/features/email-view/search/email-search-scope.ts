import {
  searchTextRuns,
  splitSearchOperators,
} from '@app/components/view-shell/search-operator-text';
import { t } from '@app/lib/i18n';
import { EMAIL_TAB_LABELS } from '../constants';
import type { EmailTab } from '../tabs';
import {
  isUnfinishedEmailSearchOperator,
  readsAsEmailSearchOperator,
} from './email-search-operators';

/**
 * The Mail views a search can be narrowed to with `in:<view>`, named as Mail
 * names them. Inbox is Focus, Signal and Noise together. Scheduled,
 * Reminders, Spam and Trash are not in the search index.
 */
const EMAIL_SEARCH_SCOPE_IDS = [
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

const isEmailSearchScopeId = (value: string): value is EmailSearchScopeId =>
  (EMAIL_SEARCH_SCOPE_IDS as readonly string[]).includes(value);

/** The views whose names start with what follows a typed `in:`. */
export const emailSearchScopesStartingWith = (prefix: string) =>
  EMAIL_SEARCH_SCOPE_IDS.filter((id) => id.startsWith(prefix.toLowerCase()));

/** The search text's tokens, a quoted phrase whole. */
const searchTokens = (text: string) =>
  searchTextRuns(text).filter((run) => !/^\s/.test(run));

/**
 * An `in:` still being typed (`in:se`), or another operator not finished yet
 * (`is:un`, `subject:`): it names nothing, so no search runs on it.
 */
function isBeingTyped(token: string) {
  const value = IN_FILTER.exec(token)?.[1]?.toLowerCase();
  if (value === undefined) return isUnfinishedEmailSearchOperator(token);

  return (
    !isEmailSearchScopeId(value) &&
    emailSearchScopesStartingWith(value).length > 0
  );
}

/**
 * Splits `in:<view>` filters out of the typed search. The last view named
 * wins. An operator still being typed (`in:se`, `is:un`) is left out of the
 * words, so the search does not run on it; every other token, the operators
 * the search service reads included (`subject:lunch`, `in:travel`), stays in
 * the query.
 */
export function parseEmailSearch(text: string): ParsedEmailSearch {
  let scope: EmailSearchScopeId | undefined;
  const words: string[] = [];

  for (const word of searchTokens(text)) {
    const value = IN_FILTER.exec(word)?.[1]?.toLowerCase();
    if (value !== undefined && isEmailSearchScopeId(value)) {
      scope = value;
      continue;
    }

    if (!isBeingTyped(word)) words.push(word);
  }

  return { query: words.join(' '), ...(scope ? { scope } : {}) };
}

/** The search text for `query` narrowed to `scope`, the filter first. */
export function formatEmailSearch(
  scope: EmailSearchScopeId | undefined,
  query: string
): string {
  return scope ? `in:${scope} ${query}` : query;
}

/**
 * Whether a token is drawn as an operator: an `in:<view>` Mail narrows the
 * search to, or an operator the search service reads.
 */
const isEmailSearchOperator = (token: string) => {
  const value = IN_FILTER.exec(token)?.[1]?.toLowerCase();
  if (value !== undefined && isEmailSearchScopeId(value)) return true;
  return !isBeingTyped(token) && readsAsEmailSearchOperator(token);
};

/**
 * The search text in runs, its complete operators marked; one still being
 * typed (`in:se`, `is:un`) stays plain.
 */
export const emailSearchTextParts = (text: string) =>
  splitSearchOperators(text, isEmailSearchOperator);

/**
 * The search as it ran, to remember: every token but an operator still being
 * typed, single-spaced.
 */
export function completeEmailSearch(text: string): string {
  return searchTokens(text)
    .filter((token) => !isBeingTyped(token))
    .join(' ');
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
