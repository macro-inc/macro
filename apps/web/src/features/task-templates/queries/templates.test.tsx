/** @vitest-environment jsdom */
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  useCreateTaskTemplate,
  useDeleteTaskTemplate,
  useUpdateTaskTemplate,
} from './templates';

let currentViewer = 'creator';
const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => currentViewer }));
vi.mock('@service-storage/task-templates', () => ({
  createTaskTemplate: api.create,
  updateTaskTemplate: api.update,
  deleteTaskTemplate: api.delete,
  listTaskTemplates: vi.fn(),
}));
afterEach(() => {
  cleanup();
  currentViewer = 'creator';
  vi.clearAllMocks();
});

it.each(['create', 'update', 'delete'] as const)(
  'does not dispatch %s after the admitted account changes',
  async (operation) => {
    const admission = Promise.withResolvers<void>();
    const client = new QueryClient({
      defaultOptions: { mutations: { onMutate: () => admission.promise } },
    });
    let commands:
      | {
          create: ReturnType<typeof useCreateTaskTemplate>;
          update: ReturnType<typeof useUpdateTaskTemplate>;
          delete: ReturnType<typeof useDeleteTaskTemplate>;
        }
      | undefined;
    const Setup = () => {
      commands = {
        create: useCreateTaskTemplate(),
        update: useUpdateTaskTemplate(),
        delete: useDeleteTaskTemplate(),
      };
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Setup />
      </QueryClientProvider>
    ));
    if (!commands) throw new Error('Template commands did not mount');
    const pending = commands[operation].mutateAsync({
      viewerId: 'creator',
      id: 'template',
      revision: 1,
      body: {
        name: 'Checklist',
        revision: 1,
        configuration: {
          propertyIds: [],
          defaults: [],
          descriptionMarkdown: '',
        },
      },
    });
    currentViewer = 'other';
    admission.resolve();
    await expect(pending).rejects.toThrow('Task template account changed');
    expect(api[operation]).not.toHaveBeenCalled();
    client.clear();
  }
);
