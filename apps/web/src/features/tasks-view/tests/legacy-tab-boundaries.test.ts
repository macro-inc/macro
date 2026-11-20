import { expect, it } from 'vitest';
import {
  createTasksViewPersistence,
  TASKS_ENTRY_STATE_KEY,
} from '../persistence';
import { tasksTabSearchCodec } from '../tasks-tab-search';
import type { TasksViewState } from '../types';

it.each([
  ['created-by-me', 'my-tasks'],
  ['created-projects', 'my-projects'],
])(
  'loads legacy %s URL state as %s and serializes the current tab',
  (legacy, current) => {
    const parsed = tasksTabSearchCodec.parse({
      tab: [legacy],
      layout: ['board'],
      groupBy: ['status'],
    });
    expect(parsed).toMatchObject({
      valid: true,
      value: { tab: current, layout: 'board', groupBy: 'status' },
    });
    expect(
      JSON.stringify(tasksTabSearchCodec.serialize(parsed.value))
    ).not.toContain(legacy);
  }
);

it.each([
  ['created-by-me', 'my-tasks'],
  ['created-projects', 'my-projects'],
])(
  'restores legacy %s entry state as %s without discarding settings',
  (legacy, current) => {
    const persistence = createTasksViewPersistence({
      handle: {
        currentEntryState: () => ({
          [TASKS_ENTRY_STATE_KEY]: {
            version: 1,
            tab: legacy,
            layout: 'board',
            groupBy: 'assignee',
            search: 'launch',
            sort: [{ id: 'created_at' }],
            facets: { priority: ['urgent'] },
          },
        }),
        registerEntryStateCaptor: () => () => {},
      },
      userId: () => undefined,
    });
    const initial: TasksViewState = {
      layout: 'list',
      tab: 'team-tasks',
      search: '',
      groupBy: 'priority',
      sort: [{ id: 'updated_at' }],
      facets: {},
      collapsedGroupIds: [],
      collapsedSidebarSectionIds: [],
    };
    const storages = persistence.storages;
    if (!Array.isArray(storages))
      throw new Error('Expected persistence storages');
    const restored = storages[1]?.restore?.(initial);
    expect(restored).toMatchObject({
      tab: current,
      layout: 'board',
      groupBy: 'assignee',
      search: 'launch',
      sort: [{ id: 'created_at' }],
      facets: { priority: ['urgent'] },
    });
  }
);
