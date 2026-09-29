import {
  type QueryClient,
  useMutation,
  useMutationState,
} from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import type {
  PendingProject,
  ProjectCreationInput,
  ProjectCreationResult,
  ProjectPropertyDraft,
} from '../context/projects-context';
import { projectKeys } from './keys';

export type ProjectCreationCapabilities = {
  create(input: { name: string; shareWithTeam: boolean }): Promise<{
    id: string;
  }>;
  /** Must not depend on the submitting composer, which closes on submit. */
  saveProperties(
    id: string,
    properties: readonly ProjectPropertyDraft[]
  ): Promise<void>;
  refresh(): Promise<void>;
};

/** Mutation variables double as the pending row, readable from any list. */
type ProjectSubmission = {
  input: ProjectCreationInput;
  submittedAt: string;
  id: Accessor<string>;
  confirm(id: string): void;
};

function projectSubmission(input: ProjectCreationInput): ProjectSubmission {
  const [id, setId] = createSignal(
    input.createdId ?? `pending-project-${crypto.randomUUID()}`
  );
  return {
    input,
    submittedAt: new Date().toISOString(),
    id,
    confirm: (created) => setId(created),
  };
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

async function runProjectCreation(
  { create, saveProperties }: ProjectCreationCapabilities,
  { input, confirm }: ProjectSubmission
): Promise<ProjectCreationResult> {
  const id =
    input.createdId ??
    (await create({ name: input.name, shareWithTeam: input.shareWithTeam })).id;
  // A list refreshed from elsewhere now returns this id; the pending row
  // stands in for that server row instead of appearing beside it.
  confirm(id);
  if (input.properties.length === 0) return { status: 'created', id };
  try {
    await saveProperties(id, input.properties);
    return { status: 'created', id };
  } catch (error) {
    return { status: 'propertiesFailed', id, error: asError(error) };
  }
}

/**
 * The mutation outlives the composer that submits it. It stays pending, and
 * so listed, until the project and its properties are saved and the lists
 * have refreshed to include them. A failed request drops the pending row.
 */
export function createProjectCreationMutation(
  capabilities: ProjectCreationCapabilities,
  cache: QueryClient
) {
  const mutation = useMutation(
    () => ({
      mutationKey: projectKeys.create.queryKey,
      mutationFn: (submission: ProjectSubmission) =>
        runProjectCreation(capabilities, submission),
      onSuccess: capabilities.refresh,
    }),
    () => cache
  );
  return {
    pending: () => mutation.isPending,
    create: async (
      input: ProjectCreationInput
    ): Promise<ProjectCreationResult> => {
      try {
        return await mutation.mutateAsync(projectSubmission(input));
      } catch (error) {
        return { status: 'failed', error: asError(error) };
      }
    },
  };
}

/** Pending creations from every composer, read from the shared mutation cache. */
export function usePendingProjects(
  cache: QueryClient
): Accessor<readonly PendingProject[]> {
  const submissions = useMutationState(
    () => ({
      filters: {
        mutationKey: projectKeys.create.queryKey,
        exact: true,
        status: 'pending' as const,
      },
      select: (mutation) =>
        mutation.state.variables as ProjectSubmission | undefined,
    }),
    () => cache
  );
  return () =>
    submissions().flatMap((submission) =>
      submission
        ? [
            {
              id: submission.id(),
              name: submission.input.name,
              properties: submission.input.properties,
              submittedAt: submission.submittedAt,
            },
          ]
        : []
    );
}
