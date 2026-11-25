import {
  isUnfinishedEmailSearchOperator,
  readsAsEmailSearchOperator,
} from '@app/features/email-view/search/email-search-operators';
import { match } from 'ts-pattern';
import type { SearchIndexId } from './search-filters';

/**
 * The operators the search service reads out of any search's query
 * (`type:task`, `status:in_progress`, `tag:finance`, `assignee:me`,
 * `in:#launch`), by the service's own rules
 * (`crates/search_service/src/api/search/search_operators.rs`; both test
 * suites read `typed_operators.json` beside it). The email operators
 * (`subject:`, `is:unread`) are Mail's (`email-search-operators.ts`) and read
 * the terms these leave.
 */

/** The kinds `type:` names, in the order the field suggests them. */
export const SEARCH_OPERATOR_TYPES = [
  'task',
  'doc',
  'email',
  'channel',
  'call',
  'folder',
  'agent',
  'calendar',
] as const;

export type SearchOperatorType = (typeof SEARCH_OPERATOR_TYPES)[number];

/** A task's statuses as `status:` names them. */
export const SEARCH_OPERATOR_TASK_STATUSES = [
  'not_started',
  'in_progress',
  'in_review',
  'completed',
  'canceled',
] as const;

/** A call's statuses as `status:` names them. */
export const SEARCH_OPERATOR_CALL_STATUSES = [
  'missed',
  'attended',
  'unattended',
] as const;

export const SEARCH_OPERATOR_PRIORITIES = [
  'urgent',
  'high',
  'medium',
  'low',
] as const;

export type SearchOperatorTaskStatus =
  (typeof SEARCH_OPERATOR_TASK_STATUSES)[number];
export type SearchOperatorCallStatus =
  (typeof SEARCH_OPERATOR_CALL_STATUSES)[number];
export type SearchOperatorPriority =
  (typeof SEARCH_OPERATOR_PRIORITIES)[number];

/** The operators' names as typed, in the order the field suggests them. */
export const SEARCH_OPERATOR_NAMES = [
  'type',
  'from',
  'assignee',
  'author',
  'status',
  'priority',
  'tag',
  'inbox',
  'in',
] as const;

export type SearchOperatorName = (typeof SEARCH_OPERATOR_NAMES)[number];

/** `me`, or the user an address names. */
export type SearchOperatorPerson = { me: true } | { me: false; userId: string };

export type SearchOperatorValue =
  | { kind: 'type'; type: SearchOperatorType }
  | { kind: 'task-status'; status: SearchOperatorTaskStatus }
  | { kind: 'call-status'; status: SearchOperatorCallStatus }
  | { kind: 'priority'; priority: SearchOperatorPriority }
  | { kind: 'person'; person: SearchOperatorPerson }
  /** A tag name, an inbox address or a channel name. */
  | { kind: 'name'; name: string };

/**
 * One operator, or several of the same name joined by `OR`, with the terms it
 * was read from.
 */
export type SearchOperatorGroup = {
  name: SearchOperatorName;
  values: SearchOperatorValue[];
  terms: string[];
};

/** The term that joins two values of one operator. */
const OR = 'OR';

const KINDS = {
  doc: 1,
  task: 1 << 1,
  email: 1 << 2,
  channel: 1 << 3,
  call: 1 << 4,
  folder: 1 << 5,
  agent: 1 << 6,
  calendar: 1 << 7,
} as const satisfies Record<SearchOperatorType, number>;

const ALL_KINDS = 0xff;
/** The kinds tags are indexed on: every kind but channels. */
const TAGGED_KINDS = ALL_KINDS & ~KINDS.channel;
const CHANNEL_OR_CALL = KINDS.channel | KINDS.call;

/** The Search view's type for each kind. */
const KIND_INDEX: Record<SearchOperatorType, SearchIndexId> = {
  doc: 'document-or-file',
  task: 'task',
  email: 'email',
  channel: 'channels',
  call: 'calls',
  folder: 'folders',
  agent: 'agent',
  calendar: 'calendar',
};

const isOneOf = <T extends string>(
  list: readonly T[],
  value: string
): value is T => (list as readonly string[]).includes(value);

const hasWord = (text: string) => /[\p{Alphabetic}\p{N}]/u.test(text);

/** Quotes a phrase is typed with, as the service reads them. */
const PHRASE_QUOTES = /["“”„‟]/;

/**
 * The query's terms as the service splits them: by whitespace outside
 * quotes, the quotes dropped.
 */
export function splitSearchTerms(text: string): string[] {
  const terms: string[] = [];
  let current = '';
  let inQuotes = false;
  const push = () => {
    const term = current.trim();
    if (term) terms.push(term);
    current = '';
  };
  for (const char of text) {
    if (PHRASE_QUOTES.test(char)) inQuotes = !inQuotes;
    else if (/\s/.test(char) && !inQuotes) push();
    else current += char;
  }
  push();
  return terms;
}

/** `name:value`, the name of letters and underscores. */
const NAME_AND_VALUE = /^([A-Za-z_]+):(.*)$/s;

const ATOM = "[A-Za-z0-9!#%&'*+/=?^_`{|}~-]+";
const LABEL = '[A-Za-z0-9-]+';
/** An address as Macro's user ids take one. */
const ADDRESS = new RegExp(`^${ATOM}(?:\\.${ATOM})*@${LABEL}(?:\\.${LABEL})*$`);
/** Something, `@`, something: the address `inbox:` takes. */
const INBOX_ADDRESS = /^[^@\s]+@[^@\s]+$/;

function person(value: string): SearchOperatorPerson | undefined {
  if (value === 'me') return { me: true };
  if (!ADDRESS.test(value)) return undefined;
  return { me: false, userId: `macro|${value}` };
}

function status(value: string): SearchOperatorValue | undefined {
  if (isOneOf(SEARCH_OPERATOR_CALL_STATUSES, value))
    return { kind: 'call-status', status: value };
  if (isOneOf(SEARCH_OPERATOR_TASK_STATUSES, value))
    return { kind: 'task-status', status: value };
  return undefined;
}

/** The operator `term` names, if it is one with a valid value. */
function operator(
  term: string
): { name: SearchOperatorName; value: SearchOperatorValue } | undefined {
  const parsed = NAME_AND_VALUE.exec(term);
  if (!parsed) return undefined;
  const [, typedName = '', value = ''] = parsed;
  if (!hasWord(value)) return undefined;
  const name = typedName.toLowerCase();
  if (!isOneOf(SEARCH_OPERATOR_NAMES, name)) return undefined;
  const lowered = value.toLowerCase();
  const read = match(name)
    .with('type', (): SearchOperatorValue | undefined =>
      isOneOf(SEARCH_OPERATOR_TYPES, lowered)
        ? { kind: 'type', type: lowered }
        : undefined
    )
    .with('status', () => status(lowered))
    .with('priority', (): SearchOperatorValue | undefined =>
      isOneOf(SEARCH_OPERATOR_PRIORITIES, lowered)
        ? { kind: 'priority', priority: lowered }
        : undefined
    )
    .with('assignee', 'author', 'from', (): SearchOperatorValue | undefined => {
      const named = person(lowered);
      return named && { kind: 'person', person: named };
    })
    .with('tag', (): SearchOperatorValue => ({ kind: 'name', name: value }))
    .with('inbox', (): SearchOperatorValue | undefined =>
      INBOX_ADDRESS.test(lowered) ? { kind: 'name', name: lowered } : undefined
    )
    // `in:` without a `#` names a Mail view or label.
    .with('in', (): SearchOperatorValue | undefined =>
      value.startsWith('#') && hasWord(value.slice(1))
        ? { kind: 'name', name: value.slice(1) }
        : undefined
    )
    .exhaustive();
  return read && { name, value: read };
}

type Entry = { word: string } | { group: SearchOperatorGroup };

const isOperatorEntry = (entry: Entry | undefined) =>
  entry !== undefined && 'group' in entry;

/**
 * `terms` as words and operators, joining an operator to the one before it
 * when `OR` stands between two of the same name, and dropping an `OR` beside
 * an operator that joins nothing.
 */
function entries(terms: readonly string[]): Entry[] {
  const joined: Entry[] = [];
  for (const term of terms) {
    const read = operator(term);
    if (!read) {
      joined.push({ word: term });
      continue;
    }
    const or = joined.at(-1);
    const previous = joined.at(-2);
    if (
      or &&
      'word' in or &&
      or.word === OR &&
      previous &&
      'group' in previous &&
      previous.group.name === read.name
    ) {
      joined.pop();
      previous.group.values.push(read.value);
      previous.group.terms.push(OR, term);
      continue;
    }
    joined.push({
      group: { name: read.name, values: [read.value], terms: [term] },
    });
  }
  const kept: Entry[] = [];
  joined.forEach((entry, index) => {
    const strayOr =
      'word' in entry &&
      entry.word === OR &&
      (isOperatorEntry(kept.at(-1)) || isOperatorEntry(joined[index + 1]));
    if (!strayOr) kept.push(entry);
  });
  return kept;
}

/** The kinds a group's name applies to, apart from what its values say. */
const NAME_KINDS: Record<SearchOperatorName, number> = {
  type: 0,
  author: KINDS.doc | KINDS.task,
  status: KINDS.task,
  priority: KINDS.task,
  assignee: KINDS.task,
  tag: TAGGED_KINDS,
  inbox: KINDS.email,
  in: CHANNEL_OR_CALL,
  from: CHANNEL_OR_CALL,
};

function applies(group: SearchOperatorGroup): number {
  return group.values.reduce((kinds, value) => {
    if (value.kind === 'type') return kinds | KINDS[value.type];
    if (value.kind === 'call-status') return kinds | KINDS.call;
    return kinds | NAME_KINDS[group.name];
  }, 0);
}

/**
 * The kinds `group` narrows a search to: those it applies to when `type:`
 * names kinds, else those it implies, `author:` meaning a task's creator.
 */
function narrowedBy(group: SearchOperatorGroup, types: number | undefined) {
  if (types === undefined && group.name === 'author') return KINDS.task;
  return applies(group);
}

function callStatuses(group: SearchOperatorGroup) {
  return [
    ...new Set(
      group.values.flatMap((value) =>
        value.kind === 'call-status' ? [value.status] : []
      )
    ),
  ];
}

/** A search's terms with its operators read out of them. */
export type SearchOperators = {
  /** The terms left to match, the email operators among them. */
  terms: string[];
  /** How many terms were operators, not counting `OR`. */
  operators: number;
  groups: SearchOperatorGroup[];
  /** The kinds `type:` named, when it named any. */
  types?: number;
};

/**
 * Reads the operators out of `terms`. `reachesChannels` says whether the
 * search can reach channels or calls; `in:#` names channels only while the
 * other operators leave channels or calls to search too, and is otherwise a
 * Mail label.
 */
export function readSearchOperators(
  terms: readonly string[],
  reachesChannels = true
): SearchOperators {
  const read = entries(terms);
  const typeKinds = read.flatMap((entry) =>
    'group' in entry && entry.group.name === 'type'
      ? [applies(entry.group)]
      : []
  );
  const types =
    typeKinds.length > 0
      ? typeKinds.reduce((all, kinds) => all & kinds, ALL_KINDS)
      : undefined;
  // `from:` is the email operator unless `type:` leaves email out and names
  // channels or calls, whose senders and speakers it then names.
  const readsFrom =
    types !== undefined &&
    (types & KINDS.email) === 0 &&
    (types & CHANNEL_OR_CALL) !== 0;
  const readable = (group: SearchOperatorGroup, readsChannels: boolean) => {
    if (group.name === 'from') return readsFrom;
    if (group.name === 'in') return readsChannels;
    if (group.name === 'status') return callStatuses(group).length <= 1;
    return true;
  };
  const narrowed = read.reduce((kinds, entry) => {
    if (!('group' in entry)) return kinds;
    const { group } = entry;
    if (group.name === 'type' || group.name === 'in') return kinds;
    if (!readable(group, false)) return kinds;
    return kinds & narrowedBy(group, types);
  }, types ?? ALL_KINDS);
  const readsChannels = reachesChannels && (narrowed & CHANNEL_OR_CALL) !== 0;

  const result: SearchOperators = {
    terms: [],
    operators: 0,
    groups: [],
    types,
  };
  for (const entry of read) {
    if ('word' in entry) {
      result.terms.push(entry.word);
    } else if (readable(entry.group, readsChannels)) {
      result.operators += entry.group.values.length;
      result.groups.push(entry.group);
    } else {
      result.terms.push(...entry.group.terms);
    }
  }
  return result;
}

/**
 * Whether the service reads `term`, alone, as one of these operators: the
 * field draws exactly these.
 */
export function readsAsSearchOperator(term: string): boolean {
  return readSearchOperators(splitSearchTerms(term)).operators > 0;
}

/**
 * The kinds of item the operators leave to search, as the Search view's
 * types; every type when none narrows them.
 */
export function searchOperatorIndexes(read: SearchOperators): SearchIndexId[] {
  let kinds = read.types ?? ALL_KINDS;
  for (const group of read.groups) {
    if (group.name !== 'type') kinds &= narrowedBy(group, read.types);
  }
  return SEARCH_OPERATOR_TYPES.filter(
    (type) => (kinds & KINDS[type]) !== 0
  ).map((type) => KIND_INDEX[type]);
}

/** The values an operator with a short list of them takes. */
const LISTED_VALUES: Partial<Record<SearchOperatorName, readonly string[]>> = {
  type: SEARCH_OPERATOR_TYPES,
  status: [...SEARCH_OPERATOR_TASK_STATUSES, ...SEARCH_OPERATOR_CALL_STATUSES],
  priority: SEARCH_OPERATOR_PRIORITIES,
};

/**
 * An operator still being typed: a name with no value yet (`status:`, `in:#`),
 * part of a value from its list (`type:ta`), or an assignee, author or inbox
 * before the address is whole (`assignee:ana@`). It names nothing yet, so
 * the search leaves it out rather than looking for it as a word.
 */
export function isUnfinishedSearchOperator(term: string): boolean {
  const parsed = NAME_AND_VALUE.exec(term);
  if (!parsed) return false;
  const [, typedName = '', value = ''] = parsed;
  const name = typedName.toLowerCase();
  if (!isOneOf(SEARCH_OPERATOR_NAMES, name) || readsAsSearchOperator(term))
    return false;
  if (name === 'in') return value === '' || value.startsWith('#');
  if (value === '') return true;
  // `from:ana` is a whole email operator: mail from a name.
  if (name === 'from') return false;
  const lowered = value.toLowerCase();
  const listed = LISTED_VALUES[name];
  if (listed) return listed.some((full) => full.startsWith(lowered));
  // A person or an inbox reads once its address is whole.
  return name !== 'tag' && !/\s/.test(value);
}

/** The query's tokens as typed, quotes kept, split by whitespace outside them. */
function typedTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of text) {
    if (PHRASE_QUOTES.test(char)) inQuotes = !inQuotes;
    if (/\s/.test(char) && !inQuotes) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** What a Search query asks for. */
export type SearchQueryParts = {
  /**
   * The text the search service is sent: the query without operators still
   * being typed, or empty when only operators are left, which the view lists
   * itself.
   */
  serviceText: string;
  /**
   * The words names are matched with, or empty when an operator narrows the
   * search past what a name match can be checked against.
   */
  nameText: string;
  read: SearchOperators;
};

/** Reads a Search query, as typed in its field. */
export function searchQueryParts(text: string): SearchQueryParts {
  const searched = typedTokens(text)
    .filter((token) => {
      const term = splitSearchTerms(token)[0] ?? token;
      return (
        !isUnfinishedSearchOperator(term) &&
        !isUnfinishedEmailSearchOperator(token)
      );
    })
    .join(' ');
  const read = readSearchOperators(splitSearchTerms(searched));
  const words = read.terms.filter((term) => !readsAsEmailSearchOperator(term));
  const onlyTypes = read.groups.every((group) => group.name === 'type');
  return {
    serviceText: read.terms.length > 0 ? searched : '',
    nameText:
      onlyTypes && words.length === read.terms.length ? words.join(' ') : '',
    read,
  };
}

/** Where an operator sits in a query, as offsets into its text. */
export type SearchOperatorSpan = { start: number; end: number };

/**
 * Where the query's operators are, to draw them: every whole token the
 * search reads as an operator, its own or Mail's. One still being typed stays
 * plain, as Mail draws it.
 */
export function searchOperatorSpans(text: string): SearchOperatorSpan[] {
  const spans: SearchOperatorSpan[] = [];
  let start = -1;
  let inQuotes = false;
  const close = (end: number) => {
    if (start < 0) return;
    const token = text.slice(start, end);
    const term = splitSearchTerms(token)[0] ?? token;
    if (
      (readsAsSearchOperator(token) || readsAsEmailSearchOperator(token)) &&
      !isUnfinishedSearchOperator(term) &&
      !isUnfinishedEmailSearchOperator(token)
    ) {
      spans.push({ start, end });
    }
    start = -1;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? '';
    if (PHRASE_QUOTES.test(char)) inQuotes = !inQuotes;
    if (/\s/.test(char) && !inQuotes) close(index);
    else if (start < 0) start = index;
  }
  close(text.length);
  return spans;
}
