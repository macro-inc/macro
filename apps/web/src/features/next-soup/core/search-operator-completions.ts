import { match } from 'ts-pattern';
import {
  SEARCH_OPERATOR_CALL_STATUSES,
  SEARCH_OPERATOR_NAMES,
  SEARCH_OPERATOR_PRIORITIES,
  SEARCH_OPERATOR_TASK_STATUSES,
  SEARCH_OPERATOR_TYPES,
  type SearchOperatorName,
} from './search-operators';

/**
 * The rows the Search field offers under it while an operator is typed at
 * its end: operator names for a word that starts one, then the values the
 * operator takes, so a row writes a whole operator the search reads.
 */

/** Fewest letters typed before operator names are offered for a word. */
const MIN_NAME_PREFIX = 2;

/** Most rows offered at once. */
const MAX_ROWS = 8;

/** Someone `assignee:`, `author:` and `from:` can name. */
export type SearchOperatorPerson = { email: string; name?: string };

/** What the field can offer as values, from data the app already holds. */
export type SearchOperatorValues = {
  /** People whose name or address starts with what is typed, best first. */
  people: readonly SearchOperatorPerson[];
  tags: readonly string[];
  inboxes: readonly string[];
  channels: readonly string[];
};

export type SearchOperatorCompletion =
  | { kind: 'name'; name: SearchOperatorName; insert: string }
  | { kind: 'value'; text: string; insert: string }
  | { kind: 'person'; person: SearchOperatorPerson | 'me'; insert: string }
  | { kind: 'tag' | 'inbox' | 'channel'; text: string; insert: string };

/** The token at the end of `text`, unless the text ends in whitespace. */
function lastToken(text: string): string | undefined {
  let inQuotes = false;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? '';
    if (char === '"') inQuotes = !inQuotes;
    else if (/\s/.test(char) && !inQuotes) start = index + 1;
  }
  const token = text.slice(start);
  return token === '' ? undefined : token;
}

/** `value` as a token's value: quoted when it holds whitespace. */
const asValue = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

const startsWith = (candidate: string, typed: string) =>
  candidate.toLowerCase().startsWith(typed.toLowerCase());

/** The operator being typed at the end of the field, if one is. */
export function searchOperatorBeingTyped(
  text: string
):
  | { name: SearchOperatorName; value: string }
  | { prefix: string }
  | undefined {
  const token = lastToken(text);
  if (!token) return undefined;
  const colon = token.indexOf(':');
  if (colon < 0) {
    return token.length >= MIN_NAME_PREFIX ? { prefix: token } : undefined;
  }
  const name = token.slice(0, colon).toLowerCase();
  if (!(SEARCH_OPERATOR_NAMES as readonly string[]).includes(name))
    return undefined;
  return {
    name: name as SearchOperatorName,
    value: token.slice(colon + 1).replaceAll('"', ''),
  };
}

const listed = (
  name: SearchOperatorName,
  values: readonly string[],
  typed: string
): SearchOperatorCompletion[] =>
  values
    .filter((value) => startsWith(value, typed))
    .map((value) => ({
      kind: 'value',
      text: value,
      insert: `${name}:${value}`,
    }));

/** The rows for the operator being typed at the end of `text`. */
export function searchOperatorCompletions(
  text: string,
  values: SearchOperatorValues
): SearchOperatorCompletion[] {
  const typing = searchOperatorBeingTyped(text);
  if (!typing) return [];
  const rows = ((): SearchOperatorCompletion[] => {
    if ('prefix' in typing) {
      return SEARCH_OPERATOR_NAMES.filter((name) =>
        startsWith(name, typing.prefix)
      ).map((name) => ({ kind: 'name', name, insert: `${name}:` }));
    }
    const { name, value } = typing;
    const people = (): SearchOperatorCompletion[] => [
      ...(startsWith('me', value)
        ? [
            {
              kind: 'person' as const,
              person: 'me' as const,
              insert: `${name}:me`,
            },
          ]
        : []),
      ...values.people.map(
        (person): SearchOperatorCompletion => ({
          kind: 'person',
          person,
          insert: `${name}:${person.email}`,
        })
      ),
    ];
    return match(name)
      .with('type', () => listed(name, SEARCH_OPERATOR_TYPES, value))
      .with('status', () =>
        listed(
          name,
          [...SEARCH_OPERATOR_TASK_STATUSES, ...SEARCH_OPERATOR_CALL_STATUSES],
          value
        )
      )
      .with('priority', () => listed(name, SEARCH_OPERATOR_PRIORITIES, value))
      .with('assignee', 'author', 'from', people)
      .with('tag', () =>
        values.tags
          .filter((tag) => startsWith(tag, value))
          .map(
            (tag): SearchOperatorCompletion => ({
              kind: 'tag',
              text: tag,
              insert: `tag:${asValue(tag)}`,
            })
          )
      )
      .with('inbox', () =>
        values.inboxes
          .filter((inbox) => startsWith(inbox, value))
          .map(
            (inbox): SearchOperatorCompletion => ({
              kind: 'inbox',
              text: inbox,
              insert: `inbox:${inbox}`,
            })
          )
      )
      .with('in', () => {
        if (value !== '' && !value.startsWith('#')) return [];
        const typedName = value.slice(1);
        return values.channels
          .filter((channel) => startsWith(channel, typedName))
          .map(
            (channel): SearchOperatorCompletion => ({
              kind: 'channel',
              text: channel,
              insert: `in:#${asValue(channel)}`,
            })
          );
      })
      .exhaustive();
  })();
  const token = lastToken(text) ?? '';
  return rows.filter((row) => row.insert !== token).slice(0, MAX_ROWS);
}

/**
 * The field's text with the token being typed replaced by `row`'s, followed
 * by a space unless the row writes an operator's name, whose value comes
 * next.
 */
export function completeSearchOperator(
  text: string,
  row: SearchOperatorCompletion
): string {
  const token = lastToken(text) ?? '';
  const kept = text.slice(0, text.length - token.length);
  return row.kind === 'name' ? `${kept}${row.insert}` : `${kept}${row.insert} `;
}
