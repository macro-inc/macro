import { normalizeFacetSelection } from '@app/features/soup';
import type {
  MakePersistedStateOptions,
  PersistenceStorage,
} from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import { DEFAULT_TASK_FACET_SELECTION } from './filters/task-facets';
import type { TasksViewState } from './types';

export const TASKS_ENTRY_STATE_KEY = 'tasks.view';
export const TASKS_LIST_ENTRY_STATE_KEY = 'tasks.listState';

const taskTabSchema = z
  .enum(['my-tasks', 'created-by-me', 'team-tasks'])
  .catch('my-tasks');

const taskGroupBySchema = z.enum([
  'none',
  'status',
  'priority',
  'assignee',
  'project',
  'date',
]);

const taskSortSchema = z.array(
  z.object({
    id: z.enum(['updated_at', 'created_at', 'viewed_at']),
    reversed: z.boolean().optional(),
  })
);

const taskFacetsSchema = z.record(z.string(), z.array(z.string()));

const tasksEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: taskTabSchema.default('my-tasks'),
  search: z.string().default(''),
  groupBy: taskGroupBySchema.default('priority'),
  sort: taskSortSchema.default([{ id: 'updated_at' }]),
  facets: taskFacetsSchema.default(
    normalizeFacetSelection(DEFAULT_TASK_FACET_SELECTION)
  ),
  collapsedGroupIds: z.array(z.string()).default([]),
});

type TasksEntryState = z.infer<typeof tasksEntryStateSchemaWithDefaults>;

const DEFAULT_TASKS_ENTRY_STATE: TasksEntryState =
  tasksEntryStateSchemaWithDefaults.parse({});
const tasksEntryStateSchema = tasksEntryStateSchemaWithDefaults.catch(
  DEFAULT_TASKS_ENTRY_STATE
);

const tasksPreferencesSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  collapsedSidebarSectionIds: z.array(z.string()).default([]),
});

type TasksPreferences = z.infer<typeof tasksPreferencesSchemaWithDefaults>;

const DEFAULT_TASKS_PREFERENCES: TasksPreferences =
  tasksPreferencesSchemaWithDefaults.parse({});
const tasksPreferencesSchema = tasksPreferencesSchemaWithDefaults.catch(
  DEFAULT_TASKS_PREFERENCES
);

const tasksListStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  focusKey: z.string().optional(),
  scrollOffset: z.number().finite().default(0),
});

type TasksListEntryState = z.infer<typeof tasksListStateSchemaWithDefaults>;

const DEFAULT_TASKS_LIST_ENTRY_STATE: TasksListEntryState =
  tasksListStateSchemaWithDefaults.parse({});
const tasksListStateSchema = tasksListStateSchemaWithDefaults.catch(
  DEFAULT_TASKS_LIST_ENTRY_STATE
);

export type TasksListStateSnapshot = {
  focusKey: TasksListEntryState['focusKey'];
  scrollOffset: TasksListEntryState['scrollOffset'];
};

export const DEFAULT_TASKS_LIST_STATE: TasksListStateSnapshot = {
  focusKey: DEFAULT_TASKS_LIST_ENTRY_STATE.focusKey,
  scrollOffset: DEFAULT_TASKS_LIST_ENTRY_STATE.scrollOffset,
};

function selectEntryState(state: TasksViewState): TasksEntryState {
  return {
    version: 1,
    tab: state.tab,
    search: state.search,
    groupBy: state.groupBy,
    sort: state.sort.map((item) => ({ ...item })),
    facets: normalizeFacetSelection(state.facets),
    collapsedGroupIds: [...state.collapsedGroupIds],
  };
}

function createTasksEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<TasksViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: TASKS_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      const restored = tasksEntryStateSchema.parse(stored);
      return {
        ...current,
        tab: restored.tab,
        search: restored.search,
        groupBy: restored.groupBy,
        sort: restored.sort.map((item) => ({ ...item })),
        facets: normalizeFacetSelection(restored.facets),
        collapsedGroupIds: [...restored.collapsedGroupIds],
      };
    },
    select: selectEntryState,
  });
}

export function createTasksListEntryStorage(
  handle: EntryPersistenceHandle
): PersistenceStorage<TasksListStateSnapshot> {
  return createEntryPersistenceStorage({
    handle,
    key: TASKS_LIST_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      const restored = tasksListStateSchema.parse(stored);

      return {
        ...current,
        focusKey: restored.focusKey,
        scrollOffset: restored.scrollOffset,
      };
    },
    select: (state): TasksListEntryState => ({
      version: 1,
      ...(state.focusKey === undefined ? {} : { focusKey: state.focusKey }),
      scrollOffset: state.scrollOffset,
    }),
  });
}

const preferencesStorage = createUserScopedStorage(
  'macro:tasks:preferences:v1'
);

function createTasksPreferencesStorage(options: {
  userId: Accessor<string | undefined>;
  restore: boolean;
}): PersistenceStorage<TasksViewState> {
  let previous: string | undefined;

  const serialize = (state: TasksViewState): string =>
    JSON.stringify({
      version: 1,
      collapsedSidebarSectionIds: [...state.collapsedSidebarSectionIds],
    } satisfies TasksPreferences);

  return {
    restore: (current) => {
      if (!options.restore) return undefined;

      const userId = options.userId();
      if (!userId) return undefined;

      const raw = preferencesStorage.read(userId);
      if (raw === null) return undefined;

      try {
        const parsed = tasksPreferencesSchema.parse(JSON.parse(raw));
        return {
          ...current,
          collapsedSidebarSectionIds: [...parsed.collapsedSidebarSectionIds],
        };
      } catch {
        return undefined;
      }
    },
    initialize: (current) => {
      previous = serialize(current);
    },
    write: (current) => {
      const userId = options.userId();
      if (!userId) return;

      const serialized = serialize(current);
      if (serialized === previous) return;

      previous = serialized;
      preferencesStorage.write(userId, serialized);
    },
  };
}

export type CreateTasksViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  userId: Accessor<string | undefined>;
  restoreEntryState?: boolean;
  restorePreferences?: boolean;
};

/** Persists Tasks navigation and user-level sidebar preferences. */
export function createTasksViewPersistence(
  options: CreateTasksViewPersistenceOptions
): MakePersistedStateOptions<TasksViewState> {
  return {
    storages: [
      createTasksPreferencesStorage({
        userId: options.userId,
        restore: options.restorePreferences ?? true,
      }),
      createTasksEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
