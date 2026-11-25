import { searchTextRuns } from '@app/components/view-shell/search-operator-text';
import { type TranslationKey, t } from '@app/lib/i18n';

/**
 * The phone Search's starters: each writes its operator into the field and
 * opens its suggestions, and shows the operator's value once the text sets
 * one. The field stays the only source of the search.
 */
export const SEARCH_STARTERS = [
  'from',
  'type',
  'tag',
  'date',
  'unread',
] as const;

export type SearchStarter = (typeof SEARCH_STARTERS)[number];

/** Mail's date operators, which the Date starter reads and writes. */
const DATE_NAMES = ['newer_than', 'older_than', 'after', 'before'];

/** The spans the Date starter offers, as `newer_than:` values. */
export const SEARCH_DATE_SPANS = [
  { value: '7d', label: 'searchOperators.lastWeek' },
  { value: '30d', label: 'searchOperators.lastMonth' },
  { value: '3m', label: 'searchOperators.lastQuarter' },
  { value: '1y', label: 'searchOperators.lastYear' },
] as const satisfies readonly { value: string; label: TranslationKey }[];

type StarterToken = { starter: SearchStarter; name: string; value: string };

/** The starter a whole token belongs to, with its name and value. */
function starterOf(token: string): StarterToken | undefined {
  const parsed = /^([A-Za-z_]+):(.*)$/s.exec(token);
  if (!parsed) return undefined;
  const name = (parsed[1] ?? '').toLowerCase();
  const value = (parsed[2] ?? '').replace(/["“”„]/g, '');
  if (name === 'from' || name === 'type' || name === 'tag')
    return { starter: name, name, value };
  if (DATE_NAMES.includes(name)) return { starter: 'date', name, value };
  if (name === 'is' && value.toLowerCase() === 'unread')
    return { starter: 'unread', name, value };
  return undefined;
}

const tokensOf = (text: string) =>
  searchTextRuns(text).filter((run) => !/^\s/.test(run));

/** The last operator `starter` sets in `text`, with a value, if any. */
export function searchStarterValue(
  text: string,
  starter: SearchStarter
): StarterToken | undefined {
  return tokensOf(text)
    .map(starterOf)
    .filter(
      (token): token is StarterToken =>
        token?.starter === starter && token.value !== ''
    )
    .at(-1);
}

/**
 * The text with `starter` started: its operators taken out and its name
 * written at the end, so the suggestions open for it; Unread is toggled. An
 * `OR` left without an operator on one side goes with them.
 */
export function startSearchOperator(
  text: string,
  starter: SearchStarter
): string {
  const tokens = tokensOf(text);
  const kept = tokens.filter((token) => starterOf(token)?.starter !== starter);
  const joined = kept.filter(
    (token, index) =>
      token !== 'OR' ||
      (index > 0 && index < kept.length - 1 && kept[index + 1] !== 'OR')
  );
  if (starter === 'unread') {
    const had = kept.length !== tokens.length;
    return [...joined, ...(had ? [] : ['is:unread'])].join(' ');
  }
  const name = starter === 'date' ? 'newer_than' : starter;
  return [...joined, `${name}:`].join(' ');
}

/** What a starter's pill reads: its name, or the value the text sets. */
export function searchStarterLabel(
  starter: SearchStarter,
  set: StarterToken | undefined
): string {
  if (!set || starter === 'unread') return t(STARTER_KEYS[starter]);
  if (starter === 'from' && set.value.toLowerCase() === 'me')
    return t('searchOperators.you');
  if (starter === 'type') {
    const key = TYPE_KEYS[set.value.toLowerCase()];
    return key ? t(key) : set.value;
  }
  if (starter === 'date') {
    if (set.name === 'newer_than') {
      const span = SEARCH_DATE_SPANS.find(
        (candidate) => candidate.value === set.value.toLowerCase()
      );
      if (span) return t(span.label);
    }
    if (set.name === 'after')
      return t('searchOperators.after', { date: set.value });
    if (set.name === 'before')
      return t('searchOperators.before', { date: set.value });
    return `${set.name}:${set.value}`;
  }
  return set.value;
}

const STARTER_KEYS: Record<SearchStarter, TranslationKey> = {
  from: 'searchOperators.starterFrom',
  type: 'searchOperators.starterType',
  tag: 'searchOperators.starterTag',
  date: 'searchOperators.starterDate',
  unread: 'searchOperators.starterUnread',
};

const TYPE_KEYS: Partial<Record<string, TranslationKey>> = {
  doc: 'searchOperators.typeDoc',
  task: 'searchOperators.typeTask',
  email: 'searchOperators.typeEmail',
  channel: 'searchOperators.typeChannel',
  call: 'searchOperators.typeCall',
  folder: 'searchOperators.typeFolder',
  agent: 'searchOperators.typeAgent',
  calendar: 'searchOperators.typeCalendar',
};
