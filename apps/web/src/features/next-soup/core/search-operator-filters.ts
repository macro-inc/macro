import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PROPERTY_OPTION_IDS } from '../../property/identifiers';
import {
  bothTargetAsts,
  compileToAst,
  defineQueryFilters,
  type Query,
  type QueryState,
  queryStateFrom,
} from '../filters/filter-store';
import {
  DEFAULT_SECTIONS,
  type SearchFiltersState,
  type SearchIndexId,
} from './search-filters';
import {
  nameAsTyped,
  SEARCH_OPERATOR_TYPES,
  type SearchOperatorBinding,
  type SearchOperatorCallStatus,
  type SearchOperatorGroup,
  type SearchOperatorName,
  type SearchOperatorPriority,
  type SearchOperators,
  type SearchOperatorTag,
  type SearchOperatorTaskStatus,
  searchOperatorIndexes,
} from './search-operators';
import {
  compileSearchQuery,
  searchIndexesFilters,
  TAG_SEARCH_TYPES,
} from './search-query';

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

/** A lookup no name reaches, for operators that carry their own ids. */
export const NO_SEARCH_OPERATOR_NAMES: SearchOperatorLookup = {
  userId: '',
  tags: () => [],
  inboxes: () => [],
  channels: () => [],
};

export type SearchOperatorFilters = {
  state: SearchFiltersState;
  /** The types left to search, or undefined when the operators keep all. */
  indexes: SearchIndexId[] | undefined;
  /** The operators ask for something no item can be. */
  matchesNothing: boolean;
  /**
   * Tag groups beyond the one `state.tags` holds, each matched by any of its
   * tags, which every item must also meet (`searchOperatorTagAst`).
   */
  moreTagGroups: SearchFiltersState['tags'][];
};

type TargetAstMap = ReturnType<typeof compileToAst>;

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

/** The tags a group's bound tokens stand for. */
const boundTags = (group: SearchOperatorGroup) =>
  group.values.flatMap((value) => (value.kind === 'tags' ? value.tags : []));

/** The channels a group's bound tokens stand for. */
const boundChannels = (group: SearchOperatorGroup) =>
  group.values.flatMap((value) =>
    value.kind === 'channels' ? value.channelIds : []
  );

/** The inboxes a group's bound tokens stand for. */
const boundInboxes = (group: SearchOperatorGroup) =>
  group.values.flatMap((value) =>
    value.kind === 'inboxes' ? value.inboxIds : []
  );

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
    groupsOf('in').map((group) =>
      unique([
        ...names(group).flatMap(lookup.channels),
        ...boundChannels(group),
      ])
    )
  );
  const inboxes = narrowed(
    groupsOf('inbox').map((group) =>
      unique([...names(group).flatMap(lookup.inboxes), ...boundInboxes(group)])
    )
  );

  const tagGroups = groupsOf('tag').map((group) => [
    ...names(group).flatMap(lookup.tags),
    ...boundTags(group),
  ]);
  if (tagGroups.some((group) => group.length === 0)) matchesNothing = true;
  // The view's tag filter is one list, any of it or all of it. Groups of
  // alternatives that must each hold (`tag:a OR tag:b tag:c`) put the first
  // group there and join the others to it, each by any of its tags.
  const allSingle = tagGroups.every((group) => group.length === 1);
  const oneList = tagGroups.length <= 1 || allSingle;
  const [firstGroup = [], ...otherGroups] = tagGroups;
  const tags = tagFilters(oneList ? tagGroups.flat() : firstGroup);

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
    tagMode: oneList && tagGroups.length > 1 ? 'all' : 'any',
  };
  return {
    state,
    indexes: allIndexes ? undefined : indexes,
    matchesNothing,
    moreTagGroups: oneList ? [] : otherGroups.map(tagFilters),
  };
}

/** `tags` as the view's tag filters, each option once. */
function tagFilters(tags: SearchOperatorTag[]): SearchFiltersState['tags'] {
  const byId = new Map(tags.map((tag) => [tag.optionId, tag.propertyId]));
  return [...byId].map(([value, propertyId]) => ({
    propertyId,
    type: 'select' as const,
    value,
  }));
}

/**
 * The tag groups `searchOperatorQuery` can't hold, compiled to join the
 * query it compiles (`bothTargetAsts`): each group matched by any of its
 * tags, every group required. Empty when there are none.
 */
export function searchOperatorTagAst({
  matchesNothing,
  moreTagGroups,
}: SearchOperatorFilters): TargetAstMap {
  if (matchesNothing) return {};
  let joined: TargetAstMap = {};
  for (const tags of moreTagGroups) {
    const { propf } = compileToAst(
      queryStateFrom({ include: { tagFilters: tags } })
    );
    if (propf) joined = bothTargetAsts(joined, { propf });
  }
  return joined;
}

/**
 * The query the Search view lists with for `filters`: the one type's
 * narrowing when a single type is left, and every condition the operators
 * set, whichever types are left, since a type's facets are otherwise only
 * compiled for that type.
 */
export function searchOperatorQuery({
  state,
  indexes,
  matchesNothing,
}: SearchOperatorFilters): Query {
  // Nothing can match, so the feed is asked for nothing rather than paged
  // through for rows that would all be dropped.
  if (matchesNothing) return defineQueryFilters({});
  const query = compileSearchQuery(state);
  // One type's compile keeps the feed to it. Several (`in:#` reads channels
  // and calls) are kept to their targets together, or the feed pages through
  // every other kind for rows the view then drops.
  const include = {
    ...(indexes && indexes.length > 1 ? searchIndexesFilters(indexes) : {}),
    ...query.include,
  };
  // A tag narrows every kind that carries tags, as on the service, while a
  // type's own compile keeps tags to the types whose facets offer them.
  if (state.tags.length) {
    include.tagFilters = state.tags;
    if (state.tagMode === 'all') include.tagFilterMode = 'all';
  }
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
/** `value` as an operator's value: quoted when it holds whitespace. */
const asValue = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

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

/**
 * A name as the value of a token the field shows: without quotes, which no
 * value can hold, and quoted when it holds whitespace.
 */
const shownValue = (name: string) => asValue(nameAsTyped(name));

/** Operator text an opener writes, with the ids its bound tokens stand for. */
export type SearchOperatorText = {
  text: string;
  bindings: SearchOperatorBinding[];
};

/**
 * The `tag:` token Search opens on for `tag`, bound to it by id, so a name
 * the field can't search by (an emoji-only tag, a teammate's tag) still
 * reaches it.
 */
export function searchTagOperator(
  tag: SearchOperatorTag & { label: string }
): SearchOperatorText {
  const token = `tag:${shownValue(tag.label)}`;
  return {
    text: token,
    bindings: [
      {
        token,
        tags: [{ propertyId: tag.propertyId, optionId: tag.optionId }],
      },
    ],
  };
}

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

const invert = (map: Record<string, string>) =>
  new Map(Object.entries(map).map(([name, id]) => [id, name]));
const STATUS_NAMES = invert(TASK_STATUS_IDS);
const PRIORITY_NAMES = invert(PRIORITY_IDS);
const CALL_STATUS_NAMES = invert(CALL_STATUSES);

/** One operator per value, joined by `OR` so any of them matches. */
/** Whole tokens, any of which may hold. */
const joined = (tokens: string[]) =>
  tokens.length ? [tokens.join(' OR ')] : [];

const anyOf = (name: string, values: (string | undefined)[]) =>
  joined(
    values
      .filter((value): value is string => Boolean(value))
      .map((value) => `${name}:${value}`)
  );

/**
 * The operators that ask for what `state` filters, to write into the Search
 * field in place of picked filters, so the field shows the whole search. As
 * when the filters are compiled, only the active type's facets are written.
 * Tags, channels and inboxes are written by the name the person sees and
 * bound to their ids, so one whose name the field can't search by (an
 * emoji-only tag, a DM) still reaches what was picked; an id with no name
 * is written as it is.
 */
export function searchFiltersOperatorText(
  state: SearchFiltersState,
  names: SearchFilterNames
): SearchOperatorText {
  const person = (id: string) => {
    if (names.userId && id.toLowerCase() === names.userId.toLowerCase())
      return 'me';
    // A name no one was matched to is written as typed, quoted if spaced.
    return id.startsWith('macro|') ? id.slice('macro|'.length) : shownValue(id);
  };
  const bindings: SearchOperatorBinding[] = [];
  const written = new Set<string>();
  const boundTag = (tag: SearchFiltersState['tags'][number]) => {
    const named = `tag:${shownValue(names.tag(tag.value) ?? tag.value)}`;
    // Tags that must all hold need tokens of their own: a token bound twice
    // stands for either tag, so a second tag of the same name is written by
    // its id.
    const token =
      state.tagMode === 'all' && written.has(named)
        ? `tag:${shownValue(tag.value)}`
        : named;
    written.add(token);
    bindings.push({
      token,
      tags: [{ propertyId: tag.propertyId, optionId: tag.value }],
    });
    return token;
  };
  const boundChannel = (id: string) => {
    const token = `in:#${shownValue(names.channel(id) ?? id)}`;
    bindings.push({ token, channelIds: [id] });
    return token;
  };
  const boundInbox = (id: string) => {
    const token = `inbox:${names.inbox(id) ?? id}`;
    bindings.push({ token, inboxIds: [id] });
    return token;
  };
  const tasks = state.type === 'task';
  const email = state.type === 'email';
  const scope = state.type === 'calls' ? state.calls : state.channels;
  const parts = [
    ...(state.type === 'all' ? [] : [searchTypeOperator(state.type)]),
    ...(tasks
      ? [
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
        ]
      : []),
    ...(state.type === 'calls' && state.calls.status
      ? [`status:${CALL_STATUS_NAMES.get(state.calls.status)}`]
      : []),
    ...(state.type === 'channels' || state.type === 'calls'
      ? [
          ...joined(scope.in.map(boundChannel)),
          ...anyOf('from', scope.from.map(person)),
        ]
      : []),
    ...(email ? joined((state.email.inboxIds ?? []).map(boundInbox)) : []),
    // Importance is Mail's Signal and Noise.
    ...(email && state.email.importance !== undefined
      ? [state.email.importance ? 'in:signal' : 'in:noise']
      : []),
  ];
  const tags = TAG_SEARCH_TYPES.has(state.type) ? state.tags.map(boundTag) : [];
  parts.push(...(state.tagMode === 'all' ? tags : joined(tags)));
  return { text: parts.join(' '), bindings };
}
