import type { Property } from '@property/types';
import { QueryClient } from '@tanstack/solid-query';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ProjectCreationInput,
  ProjectRow,
} from '../context/projects-context';
import { createProjectCollection } from '../primitives/project-collection';
import {
  createProjectCreationMutation,
  type ProjectCreationCapabilities,
  usePendingProjects,
} from './create-project';

const dueDate: Property = {
  propertyId: 'due',
  propertyDefinitionId: 'due',
  displayName: 'Due date',
  valueType: 'DATE',
  value: null,
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
};
const input: ProjectCreationInput = {
  name: 'Launch',
  shareWithTeam: true,
  properties: [
    {
      property: dueDate,
      value: { valueType: 'DATE', value: new Date('2026-10-01T00:00:00Z') },
    },
  ],
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
});

/** The list reads pending creations under its own owner; the composer's closes. */
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
    refresh: vi.fn(async () => {}),
  } satisfies ProjectCreationCapabilities;
  const pending = createRoot((dispose) => {
    disposers.push(dispose);
    return usePendingProjects(cache);
  });
  let closeComposer!: () => void;
  const commands = createRoot((dispose) => {
    closeComposer = dispose;
    disposers.push(dispose);
    return createProjectCreationMutation(service, cache);
  });
  return { cache, service, pending, commands, closeComposer };
}

it('lists the project before any request settles and keeps listing it after the composer closes', async () => {
  const creation = deferred<{ id: string }>();
  const saving = deferred();
  const refreshing = deferred();
  const { service, pending, commands, closeComposer } = setup();
  service.create.mockReturnValueOnce(creation.promise);
  service.saveProperties.mockReturnValueOnce(saving.promise);
  service.refresh.mockReturnValueOnce(refreshing.promise);
  const result = commands.create(input);
  expect(pending()).toEqual([
    {
      id: expect.stringMatching(/^pending-project-/),
      name: 'Launch',
      properties: input.properties,
      submittedAt: expect.any(String),
    },
  ]);
  closeComposer();
  await vi.waitFor(() => expect(service.create).toHaveBeenCalledOnce());
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: true,
  });
  creation.resolve({ id: 'project' });
  // Created: the row now carries the server id while properties save.
  await vi.waitFor(() =>
    expect(service.saveProperties).toHaveBeenCalledWith(
      'project',
      input.properties
    )
  );
  expect(pending().map((project) => project.id)).toEqual(['project']);
  saving.resolve();
  // Saved: it stays listed until the lists have refreshed to include it.
  await vi.waitFor(() => expect(service.refresh).toHaveBeenCalledOnce());
  expect(pending()).toHaveLength(1);
  refreshing.resolve();
  expect(await result).toEqual({ status: 'created', id: 'project' });
  expect(pending()).toEqual([]);
});

it('rolls back a failed creation without refreshing', async () => {
  const creation = deferred<{ id: string }>();
  const { service, pending, commands } = setup();
  service.create.mockReturnValueOnce(creation.promise);
  const result = commands.create(input);
  expect(pending()).toHaveLength(1);
  creation.reject(new Error('offline'));
  expect(await result).toEqual({
    status: 'failed',
    error: new Error('offline'),
  });
  expect(pending()).toEqual([]);
  expect(service.saveProperties).not.toHaveBeenCalled();
  expect(service.refresh).not.toHaveBeenCalled();
});

it('keeps the created project when a property save fails and retries only its properties', async () => {
  const saving = deferred();
  const { service, pending, commands } = setup();
  service.saveProperties.mockRejectedValueOnce(new Error('offline'));
  expect(await commands.create(input)).toEqual({
    status: 'propertiesFailed',
    id: 'project',
    error: new Error('offline'),
  });
  // The project exists, so the lists refresh to show it without its values.
  expect(service.refresh).toHaveBeenCalledOnce();
  expect(pending()).toEqual([]);
  service.saveProperties.mockReturnValueOnce(saving.promise);
  const retry = commands.create({ ...input, createdId: 'project' });
  // The retry stands in for the existing row rather than adding another.
  expect(pending().map((project) => project.id)).toEqual(['project']);
  saving.resolve();
  expect(await retry).toEqual({ status: 'created', id: 'project' });
  expect(service.create).toHaveBeenCalledOnce();
  expect(service.saveProperties).toHaveBeenCalledTimes(2);
});

it('creates a project without properties in a single request', async () => {
  const { service, commands } = setup();
  expect(await commands.create({ ...input, properties: [] })).toEqual({
    status: 'created',
    id: 'project',
  });
  expect(service.saveProperties).not.toHaveBeenCalled();
  expect(service.refresh).toHaveBeenCalledOnce();
});

it('reconciles the pending list row with the refreshed server row without a duplicate', async () => {
  const saving = deferred();
  const { service, cache, commands } = setup();
  service.saveProperties.mockReturnValueOnce(saving.promise);
  const serverRow = (id: string): ProjectRow => ({
    project: { id, name: id, descriptionDocumentId: '', updatedAt: '' },
    properties: [],
  });
  const [rows, setRows] = createSignal<readonly ProjectRow[]>([
    serverRow('older'),
  ]);
  service.refresh.mockImplementation(async () => {
    setRows([serverRow('project'), serverRow('older')]);
  });
  const collection = createRoot((dispose) => {
    disposers.push(dispose);
    const collection = createProjectCollection({
      userId: () => 'viewer',
      createSource: () => ({
        rows,
        loading: () => false,
        error: () => undefined,
        hasMore: () => false,
        loadingMore: () => false,
        loadMore: async () => {},
        refresh: async () => {},
      }),
      createPendingSource: () => ({ projects: usePendingProjects(cache) }),
    });
    collection.setGroupBy('none');
    return collection;
  });
  const shown = () =>
    collection
      .items()
      .flatMap((item) =>
        item.kind === 'entity'
          ? [`${item.entity.project.name}${item.entity.pending ? '…' : ''}`]
          : []
      );
  const result = commands.create(input);
  expect(shown()).toEqual(['Launch…', 'older']);
  await vi.waitFor(() => expect(service.saveProperties).toHaveBeenCalled());
  saving.resolve();
  expect(await result).toEqual({ status: 'created', id: 'project' });
  expect(shown()).toEqual(['project', 'older']);
});
