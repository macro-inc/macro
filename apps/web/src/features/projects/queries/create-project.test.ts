import { QueryClient } from '@tanstack/solid-query';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ProjectCreationInput,
  ProjectRow,
} from '../context/projects-context';
import { createProjectCollection } from '../primitives/project-collection';
import { dueDate, dueValue, emptySource } from '../tests/fixtures';
import {
  CREATED_PROJECT_RETENTION_MS,
  createProjectCreationMutation,
  type ProjectCreationCapabilities,
  usePendingProjects,
} from './create-project';

const input: ProjectCreationInput = {
  name: 'Launch',
  shareWithTeam: true,
  properties: [{ property: dueDate, value: dueValue }],
};

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  vi.useRealTimers();
});

/** Lists read pending creations under their own owner; the composer's closes. */
function setup() {
  const cache = new QueryClient();
  const service = {
    create: vi.fn(async (_input: { name: string; shareWithTeam: boolean }) => ({
      id: 'project',
    })),
    saveProperties: vi.fn(
      async (
        _id: string,
        _properties: ProjectCreationInput['properties']
      ): Promise<void> => {}
    ),
    revalidate: vi.fn(async (_id: string) => {}),
  } satisfies ProjectCreationCapabilities;
  const pending = createRoot((dispose) => {
    disposers.push(dispose);
    return usePendingProjects(cache);
  });
  let closeComposer!: () => void;
  const create = createRoot((dispose) => {
    closeComposer = dispose;
    disposers.push(dispose);
    return createProjectCreationMutation(service, cache);
  });
  const phases = () => pending().map(({ id, phase }) => ({ id, phase }));
  return { cache, service, pending, phases, create, closeComposer };
}

it('lists the project before any request settles, through the composer closing, until the lists refresh', async () => {
  const creation = Promise.withResolvers<{ id: string }>();
  const saving = Promise.withResolvers<void>();
  const refreshing = Promise.withResolvers<void>();
  const { service, pending, phases, create, closeComposer } = setup();
  service.create.mockReturnValueOnce(creation.promise);
  service.saveProperties.mockReturnValueOnce(saving.promise);
  service.revalidate.mockReturnValueOnce(refreshing.promise);
  const result = create(input);
  await vi.waitFor(() =>
    expect(pending()).toEqual([
      {
        id: expect.stringMatching(/^pending-project-/),
        name: 'Launch',
        properties: input.properties,
        submittedAt: expect.any(String),
        phase: 'creating',
      },
    ])
  );
  closeComposer();
  await vi.waitFor(() =>
    expect(service.create).toHaveBeenCalledWith({
      name: 'Launch',
      shareWithTeam: true,
    })
  );
  creation.resolve({ id: 'project' });
  // Created: the row carries the server id while its properties save.
  await vi.waitFor(() =>
    expect(phases()).toEqual([{ id: 'project', phase: 'saving' }])
  );
  expect(service.saveProperties).toHaveBeenCalledWith(
    'project',
    input.properties
  );
  saving.resolve();
  // The outcome does not wait for the lists, which keep the row meanwhile.
  expect(await result).toEqual({ status: 'created', id: 'project' });
  expect(service.revalidate).toHaveBeenCalledWith('project');
  await vi.waitFor(() =>
    expect(phases()).toEqual([{ id: 'project', phase: 'saved' }])
  );
  expect(pending()[0].properties).toEqual(input.properties);
  refreshing.resolve();
  await vi.waitFor(() => expect(pending()).toEqual([]));
});

it('rolls back a failed creation without refreshing', async () => {
  const creation = Promise.withResolvers<{ id: string }>();
  const { service, pending, create } = setup();
  service.create.mockReturnValueOnce(creation.promise);
  const result = create(input);
  await vi.waitFor(() => expect(pending()).toHaveLength(1));
  creation.reject(new Error('offline'));
  expect(await result).toEqual({
    status: 'failed',
    error: new Error('offline'),
  });
  await vi.waitFor(() => expect(pending()).toEqual([]));
  expect(service.saveProperties).not.toHaveBeenCalled();
  expect(service.revalidate).not.toHaveBeenCalled();
});

it('keeps the created id when a property save fails, and a retry neither creates nor re-lists', async () => {
  const refreshing = Promise.withResolvers<void>();
  const { service, pending, phases, create } = setup();
  service.saveProperties.mockRejectedValueOnce(new Error('offline'));
  service.revalidate.mockReturnValueOnce(refreshing.promise);
  expect(await create(input)).toEqual({
    status: 'propertiesFailed',
    id: 'project',
    error: new Error('offline'),
  });
  // Listed without the values that failed to save.
  await vi.waitFor(() =>
    expect(phases()).toEqual([{ id: 'project', phase: 'saved' }])
  );
  expect(pending()[0].properties).toEqual([]);
  refreshing.resolve();
  await vi.waitFor(() => expect(pending()).toEqual([]));
  const saving = Promise.withResolvers<void>();
  service.saveProperties.mockReturnValueOnce(saving.promise);
  const retry = create({ ...input, createdId: 'project' });
  // The existing project's server row stays as it is while the retry saves.
  await vi.waitFor(() =>
    expect(service.saveProperties).toHaveBeenCalledTimes(2)
  );
  expect(pending()).toEqual([]);
  saving.resolve();
  expect(await retry).toEqual({ status: 'created', id: 'project' });
  expect(service.create).toHaveBeenCalledOnce();
  expect(service.revalidate).toHaveBeenCalledTimes(2);
  expect(pending()).toEqual([]);
});

it('keeps a created project listed while the lists fail to refresh, for a bounded time', async () => {
  vi.useFakeTimers();
  const { service, phases, create } = setup();
  service.revalidate.mockRejectedValue(new Error('offline'));
  expect(await create({ ...input, properties: [] })).toEqual({
    status: 'created',
    id: 'project',
  });
  expect(service.saveProperties).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(service.revalidate).toHaveBeenCalledTimes(3);
  expect(phases()).toEqual([{ id: 'project', phase: 'saved' }]);
  await vi.advanceTimersByTimeAsync(CREATED_PROJECT_RETENTION_MS);
  expect(phases()).toEqual([]);
  expect(service.revalidate).toHaveBeenCalledTimes(3);
});

it('reconciles the pending list row with the refreshed server row without a duplicate', async () => {
  const creation = Promise.withResolvers<{ id: string }>();
  const saving = Promise.withResolvers<void>();
  const { service, cache, create } = setup();
  service.create.mockReturnValueOnce(creation.promise);
  service.saveProperties.mockReturnValueOnce(saving.promise);
  const serverRow = (id: string): ProjectRow => ({
    project: { id, name: id, descriptionDocumentId: '', updatedAt: '' },
    properties: [],
  });
  const [rows, setRows] = createSignal<readonly ProjectRow[]>([
    serverRow('older'),
  ]);
  service.revalidate.mockImplementation(async () => {
    setRows([serverRow('project'), serverRow('older')]);
  });
  const collection = createRoot((dispose) => {
    disposers.push(dispose);
    const collection = createProjectCollection({
      userId: () => 'viewer',
      createSource: () => ({ ...emptySource(), rows }),
      createPendingSource: () => ({ projects: usePendingProjects(cache) }),
    });
    collection.setGroupBy('none');
    return collection;
  });
  const shown = () =>
    collection.items().flatMap((item) =>
      item.kind === 'entity'
        ? [
            {
              name: item.entity.project.name,
              pending: item.entity.pending ?? false,
            },
          ]
        : []
    );
  const result = create(input);
  await vi.waitFor(() =>
    expect(shown()).toEqual([
      { name: 'Launch', pending: true },
      { name: 'older', pending: false },
    ])
  );
  creation.resolve({ id: 'project' });
  await vi.waitFor(() =>
    expect(shown()).toEqual([
      { name: 'Launch', pending: false },
      { name: 'older', pending: false },
    ])
  );
  saving.resolve();
  expect(await result).toEqual({ status: 'created', id: 'project' });
  await vi.waitFor(() =>
    expect(shown()).toEqual([
      { name: 'project', pending: false },
      { name: 'older', pending: false },
    ])
  );
});
