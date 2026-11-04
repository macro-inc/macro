import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import {
  type CallStatus,
  callStatusFromAttended,
  type PropertyFilter,
  type TagFilterMode,
} from '@app/features/next-soup/filters/filter-store/types';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { type Accessor, batch, createMemo } from 'solid-js';

import {
  DEFAULT_SECTIONS,
  type SearchFiltersSections,
  type SearchFiltersState,
  type SearchIndexId,
  type SearchTypeValue,
} from '../../../core/search-filters';

export type {
  SearchFiltersSections,
  SearchFiltersState,
  SearchIndexId,
  SearchTypeValue,
} from '../../../core/search-filters';
export { DEFAULT_SECTIONS } from '../../../core/search-filters';

import {
  compileSearchQuery,
  SEARCH_INDEX_SEEDS,
  TAG_SEARCH_TYPES,
} from '../../../core/search-query';

export {
  compileSearchQuery,
  SEARCH_INDEX_SEEDS,
  TAG_SEARCH_TYPES,
} from '../../../core/search-query';

/**
 * Facet state is derived from the soup view's `queryFilters` +
 * `soup.predicates` (the single source of truth — external writers like
 * Cmd+K search overrides and per-entry restore keep working untouched).
 * Setters recompile the full state through `compileSearchQuery` and replace
 * the store wholesale.
 */
export function createSearchFiltersController(binding?: {
  state: Accessor<SearchFiltersState>;
  onChange: (state: SearchFiltersState) => void;
}) {
  const view = binding ? undefined : useSoupView();
  const boundQuery = binding
    ? createMemo(() => compileSearchQuery(binding.state()))
    : undefined;

  const type = createMemo<SearchTypeValue>(
    () =>
      binding?.state().type ??
      view!.soup.predicates
        .orIds()
        .find((id): id is SearchIndexId => id in SEARCH_INDEX_SEEDS) ??
      'all'
  );

  const include = () =>
    boundQuery
      ? (boundQuery().include ?? {})
      : view!.queryFilters.state.include;
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
  const tags = createMemo<PropertyFilter[]>(() => include().tagFilters ?? []);
  const tagMode = createMemo<TagFilterMode>(
    () => include().tagFilterMode ?? 'any'
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
  let stashedTagMode: TagFilterMode = 'any';

  const apply = (state: SearchFiltersState) => {
    if (binding) return binding.onChange(state);
    batch(() => {
      view!.queryFilters.replace(compileSearchQuery(state));
      view!.soup.predicates.set(({ andIds }) => ({
        and: andIds,
        or: state.type === 'all' ? [] : [state.type],
      }));
    });
  };

  const applySections = (sections: Partial<SearchFiltersSections>) =>
    apply({
      type: type(),
      tags: tags(),
      tagMode: tagMode(),
      ...currentSections(),
      ...sections,
    });

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
    if (TAG_SEARCH_TYPES.has(current)) {
      stashedTags = tags();
      stashedTagMode = tagMode();
    }

    apply({ type: next, tags: stashedTags, tagMode: stashedTagMode, ...stash });
  };

  return {
    type,
    setType,
    tags,
    setTags: (filters: PropertyFilter[]) =>
      apply({
        type: type(),
        tags: filters,
        tagMode: tagMode(),
        ...currentSections(),
      }),
    tagMode,
    setTagMode: (mode: TagFilterMode) =>
      apply({
        type: type(),
        tags: tags(),
        tagMode: mode,
        ...currentSections(),
      }),
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
