import { sleep } from '@core/util/sleep';
import {
  type QueryClient,
  skipToken,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
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
  /** Refreshes the project and every mounted list; rejects if a list failed. */
  revalidate(id: string): Promise<void>;
};

/** The longest a saved project stays listed if the lists cannot refresh. */
export const CREATED_PROJECT_RETENTION_MS = 60_000;
const REVALIDATION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
const PENDING_KEY = projectKeys.pending.queryKey;

type SettledCreation = Exclude<ProjectCreationResult, { status: 'failed' }>;

/** One submission's row in the pending index that every list reads. */
function listPendingProject(cache: QueryClient, input: ProjectCreationInput) {
  let id = `pending-project-${crypto.randomUUID()}`;
  const update = (
    next: (projects: readonly PendingProject[]) => readonly PendingProject[]
  ) =>
    cache.setQueryData<readonly PendingProject[]>(
      PENDING_KEY,
      (projects = []) => next(projects)
    );
  const change = (patch: Partial<PendingProject>) =>
    update((projects) =>
      projects.map((project) =>
        project.id === id ? { ...project, ...patch } : project
      )
    );
  update((projects) => [
    {
      id,
      name: input.name,
      properties: input.properties,
      submittedAt: new Date().toISOString(),
      phase: 'creating',
    },
    ...projects,
  ]);
  return {
    created(createdId: string) {
      change({ id: createdId, phase: 'saving' });
      id = createdId;
    },
    saved(propertiesSaved: boolean) {
      // Values that failed to save are not shown as saved.
      change(
        propertiesSaved
          ? { phase: 'saved' }
          : { phase: 'saved', properties: [] }
      );
    },
    release() {
      update((projects) => projects.filter((project) => project.id !== id));
    },
  };
}
type PendingListing = ReturnType<typeof listPendingProject>;

type CreationVariables = {
  input: ProjectCreationInput;
  listing?: PendingListing;
  confirm(id: string): void;
};

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

async function runProjectCreation(
  { create, saveProperties }: ProjectCreationCapabilities,
  { input, confirm }: CreationVariables
): Promise<SettledCreation> {
  const id =
    input.createdId ??
    (await create({ name: input.name, shareWithTeam: input.shareWithTeam })).id;
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
 * Like a retained Soup deletion: a saved project stays listed until every
 * mounted list has refreshed, or for a bounded time if they keep failing.
 */
async function retainUntilListed(
  revalidate: () => Promise<void>,
  listing: PendingListing | undefined
) {
  let released = false;
  const release = () => {
    released = true;
    clearTimeout(expiry);
    listing?.release();
  };
  const expiry = setTimeout(release, CREATED_PROJECT_RETENTION_MS);
  for (let attempt = 1; !released; attempt++) {
    try {
      await revalidate();
      release();
    } catch {
      // Lists that never refresh keep the project until it expires.
      if (attempt >= REVALIDATION_ATTEMPTS) return;
      await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * The mutation outlives the composer that submits it and stays pending only
 * while the server writes; the lists refresh afterwards, independently.
 */
export function createProjectCreationMutation(
  capabilities: ProjectCreationCapabilities,
  cache: QueryClient
) {
  const mutation = useMutation(
    () => ({
      mutationFn: (variables: CreationVariables) =>
        runProjectCreation(capabilities, variables),
      // Neither callback may throw or wait: the outcome must reach the caller.
      onSuccess: (result: SettledCreation, { listing }: CreationVariables) => {
        listing?.saved(result.status === 'created');
        void retainUntilListed(
          () => capabilities.revalidate(result.id),
          listing
        );
      },
      onError: (_error: Error, { listing }: CreationVariables) =>
        listing?.release(),
    }),
    () => cache
  );
  return async (
    input: ProjectCreationInput
  ): Promise<ProjectCreationResult> => {
    // A retry's project is already listed, so only new projects stand in.
    const listing = input.createdId
      ? undefined
      : listPendingProject(cache, input);
    let createdId = input.createdId;
    try {
      return await mutation.mutateAsync({
        input,
        listing,
        confirm: (id) => {
          createdId = id;
          listing?.created(id);
        },
      });
    } catch (error) {
      // Once created, every outcome keeps the id so retry cannot duplicate it.
      return createdId
        ? { status: 'propertiesFailed', id: createdId, error: asError(error) }
        : { status: 'failed', error: asError(error) };
    }
  };
}

/** Creations not yet in the lists, from every composer, open or closed. */
export function usePendingProjects(
  cache: QueryClient
): Accessor<readonly PendingProject[]> {
  const pending = useQuery(
    () => ({
      queryKey: PENDING_KEY,
      queryFn: skipToken,
      initialData: [] as readonly PendingProject[],
      // Entries have bounded lifetimes even when no list observes them.
      gcTime: Infinity,
    }),
    () => cache
  );
  return () => (pending.isSuccess ? pending.data : []);
}
