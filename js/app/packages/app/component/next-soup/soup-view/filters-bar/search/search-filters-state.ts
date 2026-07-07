import { getViewPreset } from '@app/component/app-sidebar/soup-filter-presets';
import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
} from '@app/component/next-soup/filters/filter-store';
import {
  type CallStatus,
  callStatusFromAttended,
  type FieldFilters,
  type PropertyFilter,
} from '@app/component/next-soup/filters/filter-store/types';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { batch, createEffect, createMemo } from 'solid-js';
import { useSearchTagsFlag } from './search-tags-flag';

export type SearchIndexId =
  | 'channels'
  | 'document-or-file'
  | 'task'
  | 'email'
  | 'calls'
  | 'folders'
  | 'agent';

export type SearchTypeValue = SearchIndexId | 'all';

/** Search types where tag filtering applies: documents/tasks plus the mixed
 * `all` view (tags there narrow the taggable result types and leave the
 * rest untouched). */
export const TAG_SEARCH_TYPES = new Set<SearchTypeValue>([
  'all',
  'task',
  'document-or-file',
]);

/**
 * Server-side narrowing for each index type. `defineQueryFilters` NIL-fills
 * the id field of every target the input doesn't reference, so each seed
 * matches only its own entity type. Sub-facet values (importance, channel
 * ids, ...) are layered on top by `compileSearchQuery`.
 */
export const SEARCH_INDEX_SEEDS: Record<SearchIndexId, Query> = {
  channels: defineQueryFilters({ exclude: { channelId: [NIL_UUID] } }),
  'document-or-file': defineQueryFilters({ exclude: { subType: ['task'] } }),
  task: defineQueryFilters({ include: { subType: ['task'] } }),
  email: defineQueryFilters({}, { skipTargets: ['ef'] }),
  calls: defineQueryFilters({}, { skipTargets: ['callf'] }),
  folders: defineQueryFilters({ exclude: { folderId: [NIL_UUID] } }),
  agent: defineQueryFilters({ exclude: { chatId: [NIL_UUID] } }),
};

export type SearchFiltersSections = {
  // inboxIds: `undefined` = all inboxes (default), `[]` = explicitly none,
  // a subset = those inboxes — same model as the mail view's inbox filter.
  email: { importance: boolean | undefined; inboxIds: string[] | undefined };
  channels: { in: string[]; from: string[] };
  calls: { in: string[]; from: string[]; status: CallStatus | undefined };
  task: {
    status: string[];
    priority: string[];
    assignees: string[];
    createdBy: string[];
  };
};

export type SearchFiltersState = SearchFiltersSections & {
  type: SearchTypeValue;
  // Selected tags. Applied only on the all/document/task types (TAG_SEARCH_TYPES)
  // and read live from the compiled query, so they persist across those types
  // but clear when switching to a type where tags do not apply (email/channels/etc).
  // Each entry carries its owning definition id and option id; combined as one OR.
  tags: PropertyFilter[];
};

export const DEFAULT_SECTIONS: SearchFiltersSections = {
  email: { importance: undefined, inboxIds: undefined },
  channels: { in: [], from: [] },
  calls: { in: [], from: [], status: undefined },
  task: { status: [], priority: [], assignees: [], createdBy: [] },
};

/**
 * Single compile path: facet state → query filters. Both data paths (soup
 * AST feed and search-service request) derive from the resulting store
 * state, so this is the only place facet semantics turn into filters.
 *
 * `'all'` compiles to just the search preset baseline — no index narrowing
 * and no email-importance bias. Only the active type's section is compiled;
 * inactive sections never constrain results.
 */
export function compileSearchQuery(state: SearchFiltersState): Query {
  const baseline = getViewPreset('search')?.filters ?? {};
  const include: FieldFilters = { ...baseline.include };
  const exclude: FieldFilters = { ...baseline.exclude };

  // Tags apply on the all/document/task types only, so a tag filter never
  // silently empties a search narrowed to emails/channels/calls.
  if (TAG_SEARCH_TYPES.has(state.type) && state.tags.length) {
    include.tagFilters = state.tags;
  }

  if (state.type === 'all') return { include, exclude };

  const seed = SEARCH_INDEX_SEEDS[state.type];
  Object.assign(include, seed.include);
  Object.assign(exclude, seed.exclude);

  if (state.type === 'email') {
    if (state.email.importance !== undefined) {
      include.emailImportance = state.email.importance;
    }
    if (state.email.inboxIds !== undefined) {
      include.emailLinkId = state.email.inboxIds.length
        ? state.email.inboxIds
        : [NIL_UUID];
    }
  } else if (state.type === 'channels') {
    if (state.channels.in.length) include.channelId = state.channels.in;
    if (state.channels.from.length) {
      include.channelSenderId = state.channels.from;
    }
  } else if (state.type === 'calls') {
    if (state.calls.in.length) include.callChannelId = state.calls.in;
    if (state.calls.from.length) include.callSpeakerId = state.calls.from;
    if (state.calls.status !== undefined) {
      include.callStatus = state.calls.status;
    }
  } else if (state.type === 'task') {
    const properties: PropertyFilter[] = [
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
    if (state.task.createdBy.length) {
      include.documentOwnerId = state.task.createdBy;
    }
  }

  return { include, exclude };
}

/**
 * Facet state is derived from the soup view's `queryFilters` +
 * `soup.predicates` (the single source of truth — external writers like
 * Cmd+K search overrides and per-entry restore keep working untouched).
 * Setters recompile the full state through `compileSearchQuery` and replace
 * the store wholesale.
 */
export function createSearchFiltersController() {
  const { soup, queryFilters } = useSoupView();
  const searchTags = useSearchTagsFlag();

  const type = createMemo<SearchTypeValue>(
    () =>
      soup.predicates
        .orIds()
        .find((id): id is SearchIndexId => id in SEARCH_INDEX_SEEDS) ?? 'all'
  );

  const include = () => queryFilters.state.include;
  const withoutNil = (ids: string[] | undefined) =>
    (ids ?? []).filter((id) => id !== NIL_UUID);

  const emailImportance = () => include().emailImportance;
  const emailInbox = createMemo<string[] | undefined>(() => {
    const ids = include().emailLinkId;
    return ids === undefined ? undefined : withoutNil(ids);
  });
  const channelIn = createMemo(() => withoutNil(include().channelId));
  const channelFrom = createMemo(() => withoutNil(include().channelSenderId));
  const callIn = createMemo(() => withoutNil(include().callChannelId));
  const callFrom = createMemo(() => withoutNil(include().callSpeakerId));
  const callStatus = () =>
    include().callStatus ?? callStatusFromAttended(include().callAttended);

  const taskProperty = (propertyId: string) =>
    (include().properties ?? [])
      .filter((p) => p.propertyId === propertyId)
      .map((p) => p.value);
  const taskStatus = createMemo(() => taskProperty(SYSTEM_PROPERTY_IDS.STATUS));
  const taskPriority = createMemo(() =>
    taskProperty(SYSTEM_PROPERTY_IDS.PRIORITY)
  );
  const taskAssignees = createMemo(() =>
    taskProperty(SYSTEM_PROPERTY_IDS.ASSIGNEES)
  );
  const taskCreatedBy = createMemo(() => withoutNil(include().documentOwnerId));
  const tags = createMemo<PropertyFilter[]>(() =>
    searchTags() ? (include().tagFilters ?? []) : []
  );

  const currentSections = (): SearchFiltersSections => ({
    email: { importance: emailImportance(), inboxIds: emailInbox() },
    channels: { in: channelIn(), from: channelFrom() },
    calls: { in: callIn(), from: callFrom(), status: callStatus() },
    task: {
      status: taskStatus(),
      priority: taskPriority(),
      assignees: taskAssignees(),
      createdBy: taskCreatedBy(),
    },
  });

  // Per-index values are remembered for the lifetime of the view: switching
  // the type away stashes the active section, switching back rehydrates it.
  let stash: SearchFiltersSections = structuredClone(DEFAULT_SECTIONS);
  // Tags aren't a per-type section but are still remembered across type
  // switches (they compile only for TAG_SEARCH_TYPES, so `tags()` reads empty
  // on other types — snapshot them on switch-away so the selection survives).
  let stashedTags: PropertyFilter[] = [];

  const apply = (state: SearchFiltersState) =>
    batch(() => {
      queryFilters.replace(compileSearchQuery(state));
      soup.predicates.set(({ andIds }) => ({
        and: andIds,
        or: state.type === 'all' ? [] : [state.type],
      }));
    });

  // With the rollout flag off, strip tag filters restored from an earlier
  // session out of the query state so tagFilters never reaches either data
  // path (soup AST or search-service request).
  createEffect(() => {
    if (!searchTags() && include().tagFilters?.length) {
      apply({ type: type(), tags: [], ...currentSections() });
    }
  });

  const applySections = (sections: Partial<SearchFiltersSections>) =>
    apply({ type: type(), tags: tags(), ...currentSections(), ...sections });

  const setType = (next: SearchTypeValue) => {
    const current = type();
    if (next === current) return;

    if (current === 'email') {
      stash = {
        ...stash,
        email: { importance: emailImportance(), inboxIds: emailInbox() },
      };
    } else if (current === 'channels') {
      stash = { ...stash, channels: { in: channelIn(), from: channelFrom() } };
    } else if (current === 'calls') {
      stash = {
        ...stash,
        calls: { in: callIn(), from: callFrom(), status: callStatus() },
      };
    } else if (current === 'task') {
      stash = {
        ...stash,
        task: {
          status: taskStatus(),
          priority: taskPriority(),
          assignees: taskAssignees(),
          createdBy: taskCreatedBy(),
        },
      };
    }

    // Refresh the tag snapshot from the live value only while leaving a type
    // that compiles tags; other types read empty and would clobber it.
    if (TAG_SEARCH_TYPES.has(current)) stashedTags = tags();

    apply({ type: next, tags: stashedTags, ...stash });
  };

  return {
    type,
    setType,
    tags,
    setTags: (filters: PropertyFilter[]) =>
      apply({ type: type(), tags: filters, ...currentSections() }),
    emailImportance,
    setEmailImportance: (importance: boolean | undefined) =>
      applySections({ email: { importance, inboxIds: emailInbox() } }),
    emailInbox,
    setEmailInbox: (ids: string[] | undefined) =>
      applySections({
        email: { importance: emailImportance(), inboxIds: ids },
      }),
    channelIn,
    setChannelIn: (ids: string[]) =>
      applySections({ channels: { in: ids, from: channelFrom() } }),
    channelFrom,
    setChannelFrom: (ids: string[]) =>
      applySections({ channels: { in: channelIn(), from: ids } }),
    callIn,
    setCallIn: (ids: string[]) =>
      applySections({
        calls: { in: ids, from: callFrom(), status: callStatus() },
      }),
    callFrom,
    setCallFrom: (ids: string[]) =>
      applySections({
        calls: { in: callIn(), from: ids, status: callStatus() },
      }),
    callStatus,
    setCallStatus: (status: CallStatus | undefined) =>
      applySections({ calls: { in: callIn(), from: callFrom(), status } }),
    taskStatus,
    setTaskStatus: (ids: string[]) =>
      applySections({
        task: {
          status: ids,
          priority: taskPriority(),
          assignees: taskAssignees(),
          createdBy: taskCreatedBy(),
        },
      }),
    taskPriority,
    setTaskPriority: (ids: string[]) =>
      applySections({
        task: {
          status: taskStatus(),
          priority: ids,
          assignees: taskAssignees(),
          createdBy: taskCreatedBy(),
        },
      }),
    taskAssignees,
    setTaskAssignees: (ids: string[]) =>
      applySections({
        task: {
          status: taskStatus(),
          priority: taskPriority(),
          assignees: ids,
          createdBy: taskCreatedBy(),
        },
      }),
    taskCreatedBy,
    setTaskCreatedBy: (ids: string[]) =>
      applySections({
        task: {
          status: taskStatus(),
          priority: taskPriority(),
          assignees: taskAssignees(),
          createdBy: ids,
        },
      }),
  };
}

export type SearchFiltersController = ReturnType<
  typeof createSearchFiltersController
>;
