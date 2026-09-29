import type { Property } from '@property/types';
import { vi } from 'vitest';
import type {
  ProjectCreationInput,
  ProjectCreationResult,
  ProjectsContext,
  ProjectsSource,
} from '../context/projects-context';

export const dueDate: Property = {
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

export const dueValue = {
  valueType: 'DATE' as const,
  value: new Date('2026-10-01T00:00:00Z'),
};

/** Commands whose creation succeeds with `id` unless a test overrides it. */
export function fakeCommands(id = 'project') {
  return {
    createTask: vi.fn(async () => null),
    pending: () => false,
    create: vi.fn(
      async (_input: ProjectCreationInput): Promise<ProjectCreationResult> => ({
        status: 'created',
        id,
      })
    ),
    saveProperty: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
  } satisfies ReturnType<ProjectsContext['createCommands']>;
}

export function emptySource(): ProjectsSource {
  return {
    rows: () => undefined,
    loading: () => false,
    error: () => undefined,
    hasMore: () => false,
    loadingMore: () => false,
    loadMore: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  };
}

export function noPendingProjects() {
  return { projects: () => [] };
}
