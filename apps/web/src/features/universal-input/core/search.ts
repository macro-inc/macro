import { parseSearchFilters } from '../../next-soup/core/search-filters';
import {
  type SearchFilterNames,
  searchFiltersOperatorText,
} from '../../next-soup/core/search-operator-filters';
import {
  type SearchOperatorBinding,
  searchQueryParts,
  splitSearchTerms,
} from '../../next-soup/core/search-operators';
import type { InputFields } from './input';
import {
  type Recipient,
  type RecipientChoices,
  resolveRecipientTerms,
} from './recipients';

/** Structured model terms already have boundaries; never split them again. */
export function searchPeopleTerms(value: string): string[] {
  const draft = parseSearchFilters(value);
  if (draft.type === 'channels') return draft.channels.from;
  if (draft.type === 'calls') return draft.calls.from;
  if (draft.type === 'task')
    return [...draft.task.assignees, ...draft.task.createdBy];
  return [];
}

/** Resolve against the directory; ambiguous or missing identities cannot broaden a search. */
export function resolveSearchFilters(
  value: string,
  people: RecipientChoices,
  channels: Recipient[],
  inboxes: { id: string; email_address: string }[] = []
) {
  const draft = parseSearchFilters(value);
  const unresolved: string[] = [];
  const resolve = (terms: string[], options: RecipientChoices) => {
    const result = resolveRecipientTerms(terms, options, false);
    unresolved.push(...result.unresolved);
    return [
      ...result.recipients.map((recipient) => recipient.id),
      ...result.unresolved,
    ];
  };
  const state = { ...draft };
  if (draft.type === 'channels')
    state.channels = {
      in: resolve(draft.channels.in, channels),
      from: resolve(draft.channels.from, people),
    };
  if (draft.type === 'calls')
    state.calls = {
      ...draft.calls,
      in: resolve(draft.calls.in, channels),
      from: resolve(draft.calls.from, people),
    };
  if (draft.type === 'email' && draft.email.inboxIds)
    state.email = {
      ...draft.email,
      inboxIds: resolve(
        draft.email.inboxIds,
        inboxes.map((inbox) => ({
          id: inbox.id,
          email: inbox.email_address,
          label: inbox.email_address,
          kind: 'user',
        }))
      ),
    };
  if (draft.type === 'task')
    state.task = {
      ...draft.task,
      assignees: resolve(draft.task.assignees, people),
      createdBy: resolve(draft.task.createdBy, people),
    };
  return { state, draft, unresolved: [...new Set(unresolved)] };
}

/** The draft's whole search as its Search for field shows it. */
export type SearchDraftText = {
  text: string;
  /** What the text's tokens stand for, by id: a DM, a tag. */
  bindings: SearchOperatorBinding[];
  /** Names no one person or channel was matched to, which hold the search. */
  unresolved: string[];
};

/** The bindings an edited Search for kept, as the draft stores them. */
export function parseSearchBindings(value: string): SearchOperatorBinding[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as SearchOperatorBinding[]) : [];
  } catch {
    return [];
  }
}

/**
 * The names typed text gives an operator that needs someone's address
 * (`assignee:pat`, or `from:pat` in a search of channels or calls, where it
 * names a sender rather than Mail's): they pick no one, so the search would
 * look for the name as a word.
 */
export function unresolvedSearchPeople(text: string): string[] {
  const terms = splitSearchTerms(text);
  // As the reader decides: `from:` names a sender when `type:` names
  // channels or calls and not email.
  const types = terms.flatMap(
    (term) => /^type:(\w+)$/i.exec(term)?.[1]?.toLowerCase() ?? []
  );
  const senders =
    !types.includes('email') &&
    (types.includes('channel') || types.includes('call'));
  return terms.flatMap((term) => {
    const parsed = /^(from|assignee|author):(.+)$/i.exec(term);
    if (!parsed) return [];
    const name = (parsed[1] ?? '').toLowerCase();
    const value = (parsed[2] ?? '').replaceAll('"', '');
    const address = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    if (value.toLowerCase() === 'me' || address) return [];
    if (name === 'from' && !senders) return [];
    return [value];
  });
}

/**
 * Whether the text names a sender or speaker with no word beside it, which
 * lists nothing: the feed can't check who sent a message or spoke on a call.
 */
export function searchNeedsWord(
  text: string,
  bindings: readonly SearchOperatorBinding[] = []
): boolean {
  const parts = searchQueryParts(text, bindings);
  return (
    !parts.serviceText.trim() &&
    parts.read.groups.some((group) => group.name === 'from')
  );
}

/**
 * The draft's whole search as Search for shows it. Until the field is
 * edited, its extracted filters are written as operators before its words,
 * tags and channels bound to the ids picked so a DM or an emoji-only tag
 * still narrows it; an edit makes that text, and its bindings, the search.
 */
export function searchDraftText(
  fields: Pick<InputFields, 'query' | 'searchFilters' | 'searchBindings'>,
  lookups: {
    people: RecipientChoices;
    channels: Recipient[];
    inboxes: { id: string; email_address: string }[];
    names: SearchFilterNames;
  }
): SearchDraftText {
  if (!fields.searchFilters) {
    return {
      text: fields.query,
      bindings: parseSearchBindings(fields.searchBindings),
      unresolved: unresolvedSearchPeople(fields.query),
    };
  }
  const filters = resolveSearchFilters(
    fields.searchFilters,
    lookups.people,
    lookups.channels,
    lookups.inboxes
  );
  const operators = searchFiltersOperatorText(filters.state, lookups.names);
  // A name no channel or inbox was matched to is written as typed, standing
  // for no id.
  const unmatched = new Set(filters.unresolved);
  const text = [operators.text, fields.query.trim()].filter(Boolean).join(' ');
  return {
    text,
    bindings: operators.bindings.filter((binding) => {
      const ids =
        'channelIds' in binding
          ? binding.channelIds
          : 'inboxIds' in binding
            ? binding.inboxIds
            : [];
      return !ids.some((id) => unmatched.has(id));
    }),
    // The extracted words can hold an operator too, such as `from:Pat`.
    unresolved: [
      ...new Set([...filters.unresolved, ...unresolvedSearchPeople(text)]),
    ],
  };
}
