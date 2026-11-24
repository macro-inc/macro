import * as EmailValidator from 'email-validator';
import { match } from 'ts-pattern';

/**
 * The operators the search service reads out of an email search
 * (`subject:lunch`, `from:ana`, `is:unread`, `after:2026/06/01`), by the
 * service's own rules (`crates/search_service/src/api/search/email_operators.rs`;
 * both test suites read `typed_operators.json` beside it).
 */

/** The operators, in the order Mail suggests them. */
const EMAIL_SEARCH_OPERATOR_KEYS = [
  'from',
  'to',
  'subject',
  'cc',
  'bcc',
  'label',
  'in',
  'is',
  'has',
  'after',
  'before',
  'newer_than',
  'older_than',
] as const;

type EmailSearchOperatorKey = (typeof EMAIL_SEARCH_OPERATOR_KEYS)[number];

/** The operators that take one of a few values, and those values. */
const EMAIL_SEARCH_OPERATOR_VALUES = {
  is: ['unread', 'read', 'starred', 'shared'],
  has: ['attachment'],
} as const;

type EmailSearchValueKey = keyof typeof EMAIL_SEARCH_OPERATOR_VALUES;

type EmailSearchOperatorValue =
  (typeof EMAIL_SEARCH_OPERATOR_VALUES)[EmailSearchValueKey][number];

/**
 * The views the service's `in:` names, in the order Mail lists them; anything
 * else names a label.
 */
const SERVICE_VIEWS = [
  'inbox',
  'signal',
  'noise',
  'favorites',
  'sent',
  'drafts',
  'calendar',
  'shared',
  'archived',
] as const;

/**
 * Leaving one of these out is two conditions the service cannot apply before
 * paging, so `-in:signal` stays a word.
 */
const VIEWS_NOT_LEFT_OUT = ['signal', 'noise'] as const;

type ViewNotLeftOut = (typeof VIEWS_NOT_LEFT_OUT)[number];

const isLeftOutView = (
  view: (typeof SERVICE_VIEWS)[number]
): view is Exclude<(typeof SERVICE_VIEWS)[number], ViewNotLeftOut> =>
  !(VIEWS_NOT_LEFT_OUT as readonly string[]).includes(view);

/** The views `-in:` can leave out. */
export const EMAIL_SEARCH_VIEWS_LEFT_OUT = SERVICE_VIEWS.filter(isLeftOutView);

type OperatorToken = {
  exclude: boolean;
  /** The operator's name as typed, lowercased. */
  key: string;
  value: string;
};

const hasWord = (text: string) => /[\p{Alphabetic}\p{N}]/u.test(text);

const isKey = (key: string): key is EmailSearchOperatorKey =>
  (EMAIL_SEARCH_OPERATOR_KEYS as readonly string[]).includes(key);

const isValueKey = (key: string): key is EmailSearchValueKey =>
  Object.hasOwn(EMAIL_SEARCH_OPERATOR_VALUES, key);

/**
 * A minus, then `name:value`, read as the service reads a term: quotes are
 * dropped and the spaces around what is left trimmed first, and a minus
 * counts only before something with a letter or digit that does not start
 * with another minus.
 */
function readToken(token: string): OperatorToken | undefined {
  const term = token.replaceAll('"', '').trim();
  const body = term.slice(1);
  const exclude =
    term.startsWith('-') && !body.startsWith('-') && hasWord(body);
  const named = /^([A-Za-z_]+):(.*)$/s.exec(exclude ? body : term);
  if (!named) return undefined;

  const [, key = '', value = ''] = named;
  return { exclude, key: key.toLowerCase(), value };
}

const isLeapYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `2017/06/01` or `2017-06-01`, one separator throughout, a real day. */
function isDate(value: string) {
  const parts = /^(\d{1,4})([/-])(\d{1,2})\2(\d{1,2})$/.exec(value);
  if (!parts) return false;

  const [year, month, day] = [parts[1], parts[3], parts[4]].map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
  );
}

/** `3d`, `2w`, `1m` or `1y`. */
const isSpan = (value: string) => /^\d{1,4}[dwmy]$/i.test(value);

/**
 * The start of a date that typing more can still make one: a year, then a
 * separator, a month that can still be 1 to 12, the same separator, and the
 * start of a day.
 */
function isDateStart(value: string) {
  const parts = /^\d{1,4}(?:([/-])(?:(\d{1,2})(?:\1(\d?))?)?)?$/.exec(value);
  const month = parts?.[2];
  const day = parts?.[3];
  if (!parts) return false;
  if (month === undefined) return true;

  const monthNumber = Number(month);
  const monthCanBe =
    month === '0' ? day === undefined : monthNumber >= 1 && monthNumber <= 12;
  return monthCanBe && (day === undefined || day === '' || day === '0');
}

/** Whether the service reads `token` as an operator, not a search word. */
export function readsAsEmailSearchOperator(token: string): boolean {
  const read = readToken(token);
  if (!read || !hasWord(read.value)) return false;

  const value = read.value.toLowerCase();
  if (!isKey(read.key)) return false;

  return match(read.key)
    .with('subject', 'from', 'to', 'cc', 'bcc', 'label', () => true)
    .with('in', () => {
      if ((SERVICE_VIEWS as readonly string[]).includes(value)) {
        return !(
          read.exclude &&
          (VIEWS_NOT_LEFT_OUT as readonly string[]).includes(value)
        );
      }
      // Focus is a ranked list only the web app reads.
      return value !== 'focus';
    })
    .with('is', 'has', (key) =>
      (EMAIL_SEARCH_OPERATOR_VALUES[key] as readonly string[]).includes(value)
    )
    .with('after', 'before', () => isDate(read.value))
    .with('newer_than', 'older_than', () => isSpan(value))
    .exhaustive();
}

/**
 * An operator still being typed: a name with no value yet (`subject:`), part
 * of a value from a short list (`is:un`, `-in:se`), or the start of a date or
 * a span that can still become one (`after:2026/06`, `newer_than:3`). It
 * searches for nothing yet, so it is left out of the search rather than
 * searched for as a word; a date that can no longer be one
 * (`after:2026/13/01`) is a word, as the service reads it.
 */
export function isUnfinishedEmailSearchOperator(token: string): boolean {
  const read = readToken(token);
  if (!read || !isKey(read.key)) return false;

  const value = read.value.toLowerCase();
  // `-in:s` would leave out a label named `s` on its way to `-in:sent`.
  if (read.key === 'in' && read.exclude) {
    const views: readonly string[] = EMAIL_SEARCH_VIEWS_LEFT_OUT;
    if (!views.includes(value) && views.some((view) => view.startsWith(value)))
      return true;
  }
  if (readsAsEmailSearchOperator(token)) return false;
  if (!hasWord(read.value)) {
    // A date or a span starts with a digit, so `after:/` can never be one.
    const dated = ['after', 'before', 'newer_than', 'older_than'];
    return !dated.includes(read.key) || read.value === '';
  }

  if (isValueKey(read.key)) {
    return EMAIL_SEARCH_OPERATOR_VALUES[read.key].some((full) =>
      full.startsWith(value)
    );
  }
  if (read.key === 'after' || read.key === 'before') {
    return isDateStart(read.value);
  }
  if (read.key === 'newer_than' || read.key === 'older_than') {
    return /^\d{1,4}$/.test(value);
  }
  return false;
}

/** The operators that name a person, by name or address. */
const PERSON_KEYS = ['from', 'to', 'cc', 'bcc'] as const;

type EmailSearchPersonKey = (typeof PERSON_KEYS)[number];

/** The operators that name a label or a tag. */
const LABEL_KEYS = ['label', 'in'] as const;

type EmailSearchLabelKey = (typeof LABEL_KEYS)[number];

const isPersonKey = (key: string): key is EmailSearchPersonKey =>
  (PERSON_KEYS as readonly string[]).includes(key);

const isLabelKey = (key: string): key is EmailSearchLabelKey =>
  (LABEL_KEYS as readonly string[]).includes(key);

/** Someone `from:`, `to:`, `cc:` or `bcc:` can name. */
export type EmailSearchPerson = { id: string; email: string; name?: string };

/**
 * Whether mail can come from or go to `email`: a valid address outside the
 * reserved `.invalid` domain, which agent teammates' addresses use.
 */
export const canMailAddress = (email: string) =>
  EmailValidator.validate(email) && !/\.invalid$/i.test(email);

/** A mailbox label or a Macro tag that `label:` and `in:` can name. */
export type EmailSearchLabel = { name: string; kind: 'label' | 'tag' };

/** The value being typed after an operator that names someone or a label. */
export type TypedEmailSearchValue =
  | {
      kind: 'person';
      key: EmailSearchPersonKey;
      exclude: boolean;
      value: string;
    }
  | {
      kind: 'label';
      key: EmailSearchLabelKey;
      exclude: boolean;
      value: string;
    };

/**
 * What `token` names so far when it is an operator that takes a person
 * (`from:an` gives `an`) or a label (`label:trav`), quotes dropped as the
 * service drops them.
 */
export function typedEmailSearchValue(
  token: string
): TypedEmailSearchValue | undefined {
  const exclude = token.startsWith('-') && !token.startsWith('--');
  const parts = /^([A-Za-z_]+):(.*)$/s.exec(exclude ? token.slice(1) : token);
  if (!parts) return undefined;

  const key = (parts[1] ?? '').toLowerCase();
  const value = (parts[2] ?? '').replaceAll('"', '');
  if (isPersonKey(key)) return { kind: 'person', key, exclude, value };
  if (isLabelKey(key)) return { kind: 'label', key, exclude, value };
  return undefined;
}

/** A row that finishes the operator being typed at the end of the field. */
export type EmailSearchOperatorCompletion =
  | { kind: 'operator'; key: EmailSearchOperatorKey; exclude: boolean }
  | {
      kind: 'value';
      key: EmailSearchValueKey;
      value: EmailSearchOperatorValue;
      exclude: boolean;
    }
  | {
      kind: 'person';
      key: EmailSearchPersonKey;
      exclude: boolean;
      person: EmailSearchPerson;
    }
  | {
      kind: 'label';
      key: EmailSearchLabelKey;
      exclude: boolean;
      label: EmailSearchLabel;
    };

/** Fewest letters typed before operator names are offered for a word. */
const MIN_NAME_PREFIX = 2;

/**
 * What can finish `token`, the text typed at the end of the field: the
 * operators whose names start with it (`sub` gives `subject:`), or the values
 * that finish `is:` and `has:`. `in:` lists Mail's views, which the field
 * offers itself.
 */
export function completeEmailSearchOperator(
  token: string
): EmailSearchOperatorCompletion[] {
  if (token.includes('"')) return [];

  const exclude = token.startsWith('-') && !token.startsWith('--');
  const body = exclude ? token.slice(1) : token;
  const colon = body.indexOf(':');

  if (colon === -1) {
    if (body.length < MIN_NAME_PREFIX) return [];
    const prefix = body.toLowerCase();
    return EMAIL_SEARCH_OPERATOR_KEYS.filter((key) =>
      key.startsWith(prefix)
    ).map((key) => ({ kind: 'operator', key, exclude }));
  }

  const key = body.slice(0, colon).toLowerCase();
  if (!isValueKey(key)) return [];
  const prefix = body.slice(colon + 1).toLowerCase();
  return EMAIL_SEARCH_OPERATOR_VALUES[key]
    .filter((value) => value.startsWith(prefix))
    .map((value) => ({ kind: 'value', key, value, exclude }));
}

/** A value as the search reads it whole: quoted when it holds a space. */
const searchValue = (value: string) =>
  /\s/.test(value) ? `"${value}"` : value;

/** The text a picked completion puts in place of the token it finishes. */
export function emailSearchCompletionText(
  completion: EmailSearchOperatorCompletion
): string {
  const minus = completion.exclude ? '-' : '';
  return match(completion)
    .with({ kind: 'operator' }, ({ key }) => `${minus}${key}:`)
    .with({ kind: 'value' }, ({ key, value }) => `${minus}${key}:${value} `)
    .with(
      { kind: 'person' },
      ({ key, person }) => `${minus}${key}:${person.email} `
    )
    .with(
      { kind: 'label' },
      ({ key, label }) => `${minus}${key}:${searchValue(label.name)} `
    )
    .exhaustive();
}

/** Fewest letters typed before a label that only contains them is offered. */
const MIN_INNER_MATCH = 2;

/**
 * The labels and tags whose names hold what is typed, one row per name,
 * those that start with it first. A name with a quote mark is left out: the
 * search reads quotes as a phrase's ends, so it can't be named exactly.
 */
export function matchEmailSearchLabels(
  labels: readonly EmailSearchLabel[],
  typed: string
): EmailSearchLabel[] {
  const wanted = typed.toLowerCase();
  const seen = new Set<string>();
  const starts: EmailSearchLabel[] = [];
  const contains: EmailSearchLabel[] = [];
  for (const label of labels) {
    const name = label.name.toLowerCase();
    if (seen.has(name) || name.includes('"')) continue;
    seen.add(name);
    if (name.startsWith(wanted)) starts.push(label);
    else if (wanted.length >= MIN_INNER_MATCH && name.includes(wanted))
      contains.push(label);
  }
  const byName = (a: EmailSearchLabel, b: EmailSearchLabel) =>
    a.name.localeCompare(b.name);
  return [...starts.sort(byName), ...contains.sort(byName)];
}
