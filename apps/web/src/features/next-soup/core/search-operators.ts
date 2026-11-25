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

/** A tag, by the ids of its option and of the tag set holding it. */
export type SearchOperatorTag = { propertyId: string; optionId: string };

/**
 * What an opener wrote `token` into the field for, by id. It applies while
 * the token stays as written, so a tag or channel whose name the person
 * can't type as an operator that reaches it (an emoji-only tag, a
 * teammate's tag, a DM) still searches as the opener meant.
 */
export type SearchOperatorBinding =
  | { token: string; tags: SearchOperatorTag[] }
  | { token: string; channelIds: string[] }
  | { token: string; inboxIds: string[] };

export type SearchOperatorValue =
  | { kind: 'type'; type: SearchOperatorType }
  | { kind: 'task-status'; status: SearchOperatorTaskStatus }
  | { kind: 'call-status'; status: SearchOperatorCallStatus }
  | { kind: 'priority'; priority: SearchOperatorPriority }
  | { kind: 'person'; person: SearchOperatorPerson }
  /** A tag name, an inbox address or a channel name. */
  | { kind: 'name'; name: string }
  /** What a bound token stands for. */
  | { kind: 'tags'; tags: SearchOperatorTag[] }
  | { kind: 'channels'; channelIds: string[] }
  | { kind: 'inboxes'; inboxIds: string[] };

/** Whether `group` holds a bound token, which applies by id. */
export const isBoundSearchOperatorGroup = (group: SearchOperatorGroup) =>
  group.values.some(
    (value) =>
      value.kind === 'tags' ||
      value.kind === 'channels' ||
      value.kind === 'inboxes'
  );

const bindingTerm = (binding: SearchOperatorBinding) =>
  splitSearchTerms(binding.token)[0] ?? binding.token;

/**
 * The term each binding's token reads as, as the service splits it. Two
 * bindings of one token, such as two tags of the same name from different
 * tag sets, stand for the ids of both.
 */
function boundTerms(
  bindings: readonly SearchOperatorBinding[]
): Map<string, SearchOperatorBinding> {
  const bound = new Map<string, SearchOperatorBinding>();
  for (const binding of bindings) {
    const term = bindingTerm(binding);
    const known = bound.get(term);
    bound.set(term, known ? mergedBindings(known, binding) : binding);
  }
  return bound;
}

function mergedBindings(
  known: SearchOperatorBinding,
  added: SearchOperatorBinding
): SearchOperatorBinding {
  if ('tags' in known && 'tags' in added)
    return { token: known.token, tags: [...known.tags, ...added.tags] };
  if ('channelIds' in known && 'channelIds' in added)
    return {
      token: known.token,
      channelIds: [...known.channelIds, ...added.channelIds],
    };
  if ('inboxIds' in known && 'inboxIds' in added)
    return {
      token: known.token,
      inboxIds: [...known.inboxIds, ...added.inboxIds],
    };
  return added;
}

/**
 * The bindings whose token is still in `text`: one the person edited or
 * removed no longer applies, even if they type the same token again later.
 */
export function searchBindingsIn(
  text: string,
  bindings: readonly SearchOperatorBinding[]
): SearchOperatorBinding[] {
  const terms = new Set(splitSearchTerms(text));
  return bindings.filter((binding) => terms.has(bindingTerm(binding)));
}

const boundOperator = (
  binding: SearchOperatorBinding
): { name: SearchOperatorName; value: SearchOperatorValue } => {
  if ('tags' in binding)
    return { name: 'tag', value: { kind: 'tags', tags: binding.tags } };
  if ('channelIds' in binding)
    return {
      name: 'in',
      value: { kind: 'channels', channelIds: binding.channelIds },
    };
  return {
    name: 'inbox',
    value: { kind: 'inboxes', inboxIds: binding.inboxIds },
  };
};

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
const PHRASE_QUOTES = /["“”„]/;

/** Whether `char` opens or closes a phrase, as the service reads it. */
export const isPhraseQuote = (char: string) => PHRASE_QUOTES.test(char);

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
const ADDRESS = new RegExp(`^${ATOM}(?:\\.${ATOM})*@${LABEL}(?:\\.${LABEL})+$`);
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
function entries(
  terms: readonly string[],
  bindings: readonly SearchOperatorBinding[]
): Entry[] {
  const bound = boundTerms(bindings);
  const joined: Entry[] = [];
  for (const term of terms) {
    const binding = bound.get(term);
    const read = binding ? boundOperator(binding) : operator(term);
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
  reachesChannels = true,
  bindings: readonly SearchOperatorBinding[] = []
): SearchOperators {
  const read = entries(terms, bindings);
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

/** What a Search query asks for. */
export type SearchQueryParts = {
  /**
   * The text the search service is sent: the query without operators still
   * being typed, or empty when only operators are left, which the view lists
   * itself. Bound tokens are left out; they go with the request by id.
   */
  serviceText: string;
  /**
   * The words names are matched with, or empty when an operator narrows the
   * search past what a name match can be checked against.
   */
  nameText: string;
  read: SearchOperators;
  /** The operators holding a bound token, which the request carries by id. */
  bound: SearchOperators;
};

/** A token where it sits in the query, with the term it reads as. */
type QueryToken = { token: string; term: string; start: number; end: number };

/**
 * The query's whole tokens, quotes kept, split by whitespace outside them:
 * the Search view's operators still being typed left out, bound tokens
 * always kept.
 */
function finishedTokens(
  text: string,
  bindings: readonly SearchOperatorBinding[]
): QueryToken[] {
  const bound = boundTerms(bindings);
  const tokens: QueryToken[] = [];
  let start = -1;
  let inQuotes = false;
  const close = (end: number) => {
    if (start < 0) return;
    const token = text.slice(start, end);
    const term = splitSearchTerms(token)[0];
    if (
      term !== undefined &&
      (bound.has(term) || !isUnfinishedSearchOperator(term))
    ) {
      tokens.push({ token, term, start, end });
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
  return tokens;
}

/**
 * The tokens the search reads: beside a term with a letter or digit, one
 * without either (`-`, `&`, an emoji) is dropped before operators are read,
 * as the service drops it, so it doesn't count as the word operators need.
 */
const readTokens = (tokens: QueryToken[]) =>
  tokens.some(({ term }) => hasWord(term))
    ? tokens.filter(({ term }) => hasWord(term))
    : tokens;

/**
 * Which of `terms` each of `groups` was read from: a group's terms stand
 * together, in the order the groups were read.
 */
function groupTermIndexes(
  terms: readonly string[],
  groups: readonly SearchOperatorGroup[]
): number[][] {
  let from = 0;
  return groups.map((group) => {
    for (
      let start = from;
      start + group.terms.length <= terms.length;
      start++
    ) {
      if (group.terms.every((term, offset) => terms[start + offset] === term)) {
        from = start + group.terms.length;
        return group.terms.map((_, offset) => start + offset);
      }
    }
    return [];
  });
}

/**
 * A query's tokens as the search reads them, with the opener's bindings.
 * Mail's operators still being typed are left out only where email is
 * searched; elsewhere they are words, as on the service.
 */
function readQuery(text: string, bindings: readonly SearchOperatorBinding[]) {
  const read = (tokens: QueryToken[]) => {
    const readable = readTokens(tokens);
    const terms = readable.map(({ term }) => term);
    const operators = readSearchOperators(terms, true, bindings);
    const searchesEmail = searchOperatorIndexes(operators).includes('email');
    return { tokens, readable, terms, read: operators, searchesEmail };
  };
  const all = finishedTokens(text, bindings);
  const first = read(all);
  if (!first.searchesEmail) return first;
  const bound = boundTerms(bindings);
  const finished = all.filter(
    ({ token, term }) =>
      bound.has(term) || !isUnfinishedEmailSearchOperator(token)
  );
  return finished.length === all.length ? first : read(finished);
}

/** Reads a Search query, as typed in its field, with the opener's bindings. */
export function searchQueryParts(
  text: string,
  bindings: readonly SearchOperatorBinding[] = []
): SearchQueryParts {
  const { tokens, readable, terms, read, searchesEmail } = readQuery(
    text,
    bindings
  );
  const boundTokens = new Set(
    groupTermIndexes(terms, read.groups)
      .filter((_, index) => {
        const group = read.groups[index];
        return group !== undefined && isBoundSearchOperatorGroup(group);
      })
      .flat()
      .map((index) => readable[index])
  );
  // An `OR` beside a bound token, which the reader drops, would reach the
  // service as a word once the token is left out of its text.
  readable.forEach((token, index) => {
    const besideBound =
      boundTokens.has(readable[index - 1]) ||
      boundTokens.has(readable[index + 1]);
    if (token.term === OR && besideBound) boundTokens.add(token);
  });
  const boundGroups = read.groups.filter(isBoundSearchOperatorGroup);
  // Mail's operators are conditions only where email is searched.
  const words = searchesEmail
    ? read.terms.filter((term) => !readsAsEmailSearchOperator(term))
    : read.terms;
  const onlyTypes = read.groups.every((group) => group.name === 'type');
  return {
    serviceText:
      read.terms.length > 0
        ? tokens
            .filter((token) => !boundTokens.has(token))
            .map(({ token }) => token)
            .join(' ')
        : '',
    nameText:
      onlyTypes && words.length === read.terms.length ? words.join(' ') : '',
    read,
    bound: {
      terms: [],
      operators: boundGroups.reduce(
        (count, group) => count + group.values.length,
        0
      ),
      groups: boundGroups,
      types: undefined,
    },
  };
}

/** Where an operator sits in a query, as offsets into its text. */
export type SearchOperatorSpan = { start: number; end: number };

/**
 * Where the query's operators are, to draw them: each whole token the search
 * reads as an operator, its own or Mail's, read with the rest of the query.
 * Mail's draw only where email is searched, since elsewhere they are words.
 * One still being typed stays plain, as Mail draws it.
 */
export function searchOperatorSpans(
  text: string,
  bindings: readonly SearchOperatorBinding[] = []
): SearchOperatorSpan[] {
  const { readable, read, searchesEmail } = readQuery(text, bindings);
  // The words the operators leave, counted, so of two equal tokens only the
  // one read as an operator is drawn.
  const words = new Map<string, number>();
  for (const term of read.terms) words.set(term, (words.get(term) ?? 0) + 1);
  return readable.flatMap(({ start, end, token, term }) => {
    const left = words.get(term) ?? 0;
    // Read as an operator in its place; an `OR` joining two stays plain.
    if (left === 0) return term === OR ? [] : [{ start, end }];
    words.set(term, left - 1);
    return searchesEmail && readsAsEmailSearchOperator(token)
      ? [{ start, end }]
      : [];
  });
}
