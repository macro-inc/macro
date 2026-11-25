import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PROPERTY_OPTION_IDS } from '../../property/identifiers';
import type { Query, QueryState } from '../filters/filter-store';
import {
  DEFAULT_SECTIONS,
  type SearchFiltersState,
  type SearchIndexId,
} from './search-filters';
import {
  SEARCH_OPERATOR_TYPES,
  type SearchOperatorCallStatus,
  type SearchOperatorGroup,
  type SearchOperatorName,
  type SearchOperatorPriority,
  type SearchOperators,
  type SearchOperatorTaskStatus,
  searchOperatorIndexes,
} from './search-operators';
import { compileSearchQuery } from './search-query';

/**
 * Turns the operators read out of a Search query into the filters the
 * Search view's types and facets set, so a search of operators alone lists
 * through the view's own feed, as picking the same filters does, instead of
 * asking the search service, which reads operators only beside a word.
 */

const TASK_STATUS_IDS: Record<SearchOperatorTaskStatus, string> = {
  not_started: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  in_progress: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  in_review: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  completed: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
  canceled: PROPERTY_OPTION_IDS.STATUS.CANCELED,
};

const PRIORITY_IDS: Record<SearchOperatorPriority, string> = {
  urgent: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
  high: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
  medium: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
  low: PROPERTY_OPTION_IDS.PRIORITY.LOW,
};

const CALL_STATUSES: Record<
  SearchOperatorCallStatus,
  NonNullable<SearchFiltersState['calls']['status']>
> = {
  missed: 'MISSED',
  attended: 'ATTENDED',
  unattended: 'UNATTENDED',
};

/** A tag option, by its tag set and its own id. */
export type SearchOperatorTag = { propertyId: string; optionId: string };

/** What the caller's names reach, from data the app already holds. */
export type SearchOperatorLookup = {
  /** Who `me` is. */
  userId: string;
  /** The caller's tag options with this label, ignoring case. */
  tags: (name: string) => SearchOperatorTag[];
  /** The caller's inboxes with this address, ignoring case. */
  inboxes: (address: string) => string[];
  /** The channels the caller is in whose whole name is this, ignoring case. */
  channels: (name: string) => string[];
};

export type SearchOperatorFilters = {
  state: SearchFiltersState;
  /** The types left to search, or undefined when the operators keep all. */
  indexes: SearchIndexId[] | undefined;
  /** The operators ask for something no item can be. */
  matchesNothing: boolean;
};

const unique = <T>(values: T[]) => [...new Set(values)];

/** The values every group shares, or undefined when no group gave any. */
function shared(groups: string[][]): string[] | undefined {
  const [first, ...rest] = groups;
  if (!first) return undefined;
  return unique(first).filter((value) =>
    rest.every((group) => group.includes(value))
  );
}

function userIds(group: SearchOperatorGroup, userId: string): string[] {
  return unique(
    group.values.flatMap((value) => {
      if (value.kind !== 'person') return [];
      return [value.person.me ? userId.toLowerCase() : value.person.userId];
    })
  );
}

const names = (group: SearchOperatorGroup) =>
  group.values.flatMap((value) => (value.kind === 'name' ? [value.name] : []));

/**
 * The filters `read` sets. Values joined by `OR` widen a filter; repeated
 * operators must all hold, so their values intersect, and a name that
 * reaches nothing, as for the search service, matches nothing.
 */
export function searchOperatorFilters(
  read: SearchOperators,
  lookup: SearchOperatorLookup
): SearchOperatorFilters {
  let matchesNothing = false;
  const groupsOf = (name: SearchOperatorName) =>
    read.groups.filter((group) => group.name === name);
  const narrowed = (groups: string[][]) => {
    const values = shared(groups) ?? [];
    if (groups.length > 0 && values.length === 0) matchesNothing = true;
    return values;
  };

  const status = groupsOf('status');
  const taskStatus = narrowed(
    status
      .map((group) =>
        group.values.flatMap((value) =>
          value.kind === 'task-status' ? [TASK_STATUS_IDS[value.status]] : []
        )
      )
      .filter((ids) => ids.length > 0)
  );
  const callStatus = narrowed(
    status
      .map((group) =>
        group.values.flatMap((value) =>
          value.kind === 'call-status' ? [CALL_STATUSES[value.status]] : []
        )
      )
      .filter((ids) => ids.length > 0)
  );
  const priority = narrowed(
    groupsOf('priority').map((group) =>
      group.values.flatMap((value) =>
        value.kind === 'priority' ? [PRIORITY_IDS[value.priority]] : []
      )
    )
  );
  const assignees = narrowed(
    groupsOf('assignee').map((group) => userIds(group, lookup.userId))
  );
  const createdBy = narrowed(
    groupsOf('author').map((group) => userIds(group, lookup.userId))
  );
  const from = narrowed(
    groupsOf('from').map((group) => userIds(group, lookup.userId))
  );
  const channels = narrowed(
    groupsOf('in').map((group) => unique(names(group).flatMap(lookup.channels)))
  );
  const inboxes = narrowed(
    groupsOf('inbox').map((group) =>
      unique(names(group).flatMap(lookup.inboxes))
    )
  );

  const tagGroups = groupsOf('tag').map((group) =>
    names(group).flatMap(lookup.tags)
  );
  if (tagGroups.some((group) => group.length === 0)) matchesNothing = true;
  // The view applies one list of tags, any of them or all, so groups of
  // alternatives that must each hold can't be listed, as the service refuses.
  const allSingle = tagGroups.every((group) => group.length === 1);
  if (tagGroups.length > 1 && !allSingle) matchesNothing = true;
  const tagsById = new Map(
    tagGroups.flat().map((tag) => [tag.optionId, tag.propertyId])
  );
  const tags = [...tagsById].map(([value, propertyId]) => ({
    propertyId,
    type: 'select' as const,
    value,
  }));

  const indexes = searchOperatorIndexes(read);
  if (indexes.length === 0) matchesNothing = true;
  const allIndexes = indexes.length === SEARCH_OPERATOR_TYPES.length;

  const state: SearchFiltersState = {
    type: indexes.length === 1 && indexes[0] ? indexes[0] : 'all',
    email: inboxes.length ? { inboxIds: inboxes } : DEFAULT_SECTIONS.email,
    channels: { in: channels, from },
    calls: {
      in: channels,
      from,
      status: callStatus[0] as SearchFiltersState['calls']['status'],
    },
    task: { status: taskStatus, priority, assignees, createdBy },
    tags,
    tagMode: tagGroups.length > 1 ? 'all' : 'any',
  };
  return { state, indexes: allIndexes ? undefined : indexes, matchesNothing };
}

/**
 * The query the Search view lists with for `filters`: the one type's
 * narrowing when a single type is left, and every condition the operators
 * set, whichever types are left, since a type's facets are otherwise only
 * compiled for that type.
 */
export function searchOperatorQuery({ state }: SearchOperatorFilters): Query {
  const query = compileSearchQuery(state);
  const include = { ...query.include };
  if (state.email.inboxIds?.length) include.emailLinkId = state.email.inboxIds;
  if (state.channels.in.length) include.channelId = state.channels.in;
  if (state.channels.from.length) include.channelSenderId = state.channels.from;
  if (state.calls.in.length) include.callChannelId = state.calls.in;
  if (state.calls.from.length) include.callSpeakerId = state.calls.from;
  if (state.calls.status) include.callStatus = state.calls.status;
  if (state.task.createdBy.length)
    include.documentOwnerId = state.task.createdBy;
  const properties = [
    ...state.task.status.map((value) => ({
      propertyId: SYSTEM_PROPERTY_IDS.STATUS,
      type: 'select' as const,
      value,
    })),
    ...state.task.priority.map((value) => ({
      propertyId: SYSTEM_PROPERTY_IDS.PRIORITY,
      type: 'select' as const,
      value,
    })),
    ...state.task.assignees.map((value) => ({
      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      type: 'entity' as const,
      value,
    })),
  ];
  if (properties.length) include.properties = properties;
  return { include, exclude: query.exclude };
}

/**
 * The view's own filters with the conditions a query's operators set: an
 * operator's field replaces the view's, its exclusions add to them.
 */
export function withSearchOperatorQuery(
  state: QueryState,
  operators: Query
): QueryState {
  const exclude: QueryState['exclude'] = { ...state.exclude };
  for (const [key, values] of Object.entries(operators.exclude ?? {})) {
    const field = key as keyof QueryState['exclude'];
    const current = exclude[field];
    exclude[field] = (
      Array.isArray(current) && Array.isArray(values)
        ? [...new Set([...current, ...values])]
        : values
    ) as never;
  }
  return {
    ...state,
    include: { ...state.include, ...operators.include },
    exclude,
  };
}

/** The `type:` value for each of the Search view's types. */
const INDEX_TYPES: Record<SearchIndexId, string> = {
  'document-or-file': 'doc',
  task: 'task',
  email: 'email',
  channels: 'channel',
  calls: 'call',
  folders: 'folder',
  agent: 'agent',
  calendar: 'calendar',
};

/** The `tag:` operator that asks for the tag named `label`. */
export const searchTagOperator = (label: string) =>
  `tag:${/\s/.test(label) ? `"${label}"` : label}`;

/** The `type:` operator that narrows a search to `index`. */
export const searchTypeOperator = (index: SearchIndexId) =>
  `type:${INDEX_TYPES[index]}`;

/** What ids in a filter state are called, to write them as operators. */
export type SearchFilterNames = {
  /** Who `me` is, so the searcher's own id is written as `me`. */
  userId?: string;
  tag: (optionId: string) => string | undefined;
  channel: (channelId: string) => string | undefined;
  inbox: (linkId: string) => string | undefined;
};

/** `value` as an operator's value: quoted when it holds whitespace. */
const asValue = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

const invert = (map: Record<string, string>) =>
  new Map(Object.entries(map).map(([name, id]) => [id, name]));
const STATUS_NAMES = invert(TASK_STATUS_IDS);
const PRIORITY_NAMES = invert(PRIORITY_IDS);
const CALL_STATUS_NAMES = invert(CALL_STATUSES);

/** One operator per value, joined by `OR` so any of them matches. */
const anyOf = (name: string, values: (string | undefined)[]) => {
  const written = values.filter((value): value is string => Boolean(value));
  return written.length
    ? [written.map((value) => `${name}:${value}`).join(' OR ')]
    : [];
};

/**
 * The operators that ask for what `state` filters, to write into the Search
 * field in place of picked filters, so the field shows the whole search. An
 * id with no name to write is left out.
 */
export function searchFiltersOperatorText(
  state: SearchFiltersState,
  names: SearchFilterNames
): string {
  const person = (id: string) => {
    if (names.userId && id.toLowerCase() === names.userId.toLowerCase())
      return 'me';
    return id.startsWith('macro|') ? id.slice('macro|'.length) : undefined;
  };
  const scope = state.type === 'calls' ? state.calls : state.channels;
  const parts = [
    ...(state.type === 'all' ? [] : [searchTypeOperator(state.type)]),
    ...anyOf(
      'status',
      state.task.status.map((id) => STATUS_NAMES.get(id))
    ),
    ...anyOf(
      'priority',
      state.task.priority.map((id) => PRIORITY_NAMES.get(id))
    ),
    ...anyOf('assignee', state.task.assignees.map(person)),
    ...anyOf('author', state.task.createdBy.map(person)),
    ...(state.type === 'calls' && state.calls.status
      ? [`status:${CALL_STATUS_NAMES.get(state.calls.status)}`]
      : []),
    ...(state.type === 'channels' || state.type === 'calls'
      ? [
          ...anyOf(
            'in',
            scope.in.map((id) => {
              const name = names.channel(id);
              return name ? `#${asValue(name)}` : undefined;
            })
          ),
          ...anyOf('from', scope.from.map(person)),
        ]
      : []),
    ...anyOf('inbox', (state.email.inboxIds ?? []).map(names.inbox)),
  ];
  const tags = state.tags.map((tag) => {
    const label = names.tag(tag.value);
    return label ? asValue(label) : undefined;
  });
  if (state.tagMode === 'all') {
    for (const tag of tags) if (tag) parts.push(`tag:${tag}`);
  } else {
    parts.push(...anyOf('tag', tags));
  }
  return parts.join(' ');
}
