import { throwOnErr } from '@core/util/result';
import type { storageServiceClient } from '@service-storage/client';
import type { ImportPage } from '@service-storage/generated/schemas/importPage';
import type { ImportProgress } from '@service-storage/generated/schemas/importProgress';
import { JobStatus } from '@service-storage/generated/schemas/jobStatus';
import type { SlackCompleteRequest } from '@service-storage/generated/schemas/slackCompleteRequest';
import type { SlackCreateRequest } from '@service-storage/generated/schemas/slackCreateRequest';
import type { SlackRegisterRequest } from '@service-storage/generated/schemas/slackRegisterRequest';
import type { UploadGrant } from '@service-storage/generated/schemas/uploadGrant';
import {
  type QueryClient,
  queryOptions,
  type UndefinedInitialDataOptions,
  type UseMutationOptions,
} from '@tanstack/solid-query';
import { z } from 'zod';
import { slackImportKeys } from './keys';

export type SlackImportClient = Pick<
  typeof storageServiceClient,
  | 'listSlackImports'
  | 'getSlackImport'
  | 'createSlackImport'
  | 'registerSlackImportUploads'
  | 'completeSlackImportUploads'
  | 'finalizeSlackImport'
  | 'cancelSlackImport'
>;

export type ImportScope = { teamId: string; jobId: string };
type ScopedData<T> = { teamId: string | null; value: T | null };
const EMPTY_LIST: ScopedData<ImportPage> = { teamId: null, value: null };
const EMPTY_JOB: ScopedData<ImportProgress> = { teamId: null, value: null };
const MAX_UPLOAD_BATCH = 50;

export function importIsActive(job: ImportProgress): boolean {
  return (
    job.status === 'uploading' ||
    job.status === 'processing' ||
    job.status === 'cancelling' ||
    job.conversations.some(
      (conversation) =>
        conversation.search.status === 'pending' ||
        conversation.search.status === 'submitted'
    )
  );
}

export function slackImportListOptions(
  client: SlackImportClient,
  teamId: string,
  enabled: boolean,
  before?: string
): ReturnType<UndefinedInitialDataOptions<ScopedData<ImportPage>>> {
  return queryOptions<ScopedData<ImportPage>>({
    queryKey: slackImportKeys.list(teamId, before).queryKey,
    enabled: enabled && Boolean(teamId),
    queryFn: async ({ signal }): Promise<ScopedData<ImportPage>> => ({
      teamId,
      value: await throwOnErr(() =>
        client.listSlackImports({ before, signal })
      ),
    }),
    placeholderData: EMPTY_LIST,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.value?.jobs.some(importIsActive) ? 3_000 : 15_000,
  });
}

export function slackImportJobOptions(
  client: SlackImportClient,
  scope: ImportScope,
  enabled: boolean
): ReturnType<UndefinedInitialDataOptions<ScopedData<ImportProgress>>> {
  return queryOptions<ScopedData<ImportProgress>>({
    queryKey: slackImportKeys.job(scope.teamId, scope.jobId).queryKey,
    enabled: enabled && Boolean(scope.teamId && scope.jobId),
    queryFn: async ({ signal }): Promise<ScopedData<ImportProgress>> => ({
      teamId: scope.teamId,
      value: await throwOnErr(() =>
        client.getSlackImport({ jobId: scope.jobId, signal })
      ),
    }),
    placeholderData: EMPTY_JOB,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.value && importIsActive(query.state.data.value)
        ? 3_000
        : 15_000,
  });
}

const updateSchema = z.object({
  teamId: z.string().uuid(),
  jobId: z.string().uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.nativeEnum(JobStatus),
});

export function parseSlackImportUpdate(
  payload: unknown
): z.infer<typeof updateSchema> | undefined {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return undefined;
    }
  }
  const parsed = updateSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

/** List pages for this team plus exactly this receipt, never another team's cache. */
export async function invalidateSlackImport(
  cache: QueryClient,
  scope: ImportScope
): Promise<void> {
  await Promise.all([
    cache.invalidateQueries({
      queryKey: slackImportKeys.list._def,
      predicate: (query) => query.queryKey[2] === scope.teamId,
    }),
    cache.invalidateQueries({
      queryKey: slackImportKeys.job(scope.teamId, scope.jobId).queryKey,
      exact: true,
    }),
  ]);
}

type MutationOptions<Data, Variables> = ReturnType<
  UseMutationOptions<Data, Error, Variables>
>;
type ImportMutationOptions = {
  create: MutationOptions<
    ImportProgress,
    { teamId: string; body: SlackCreateRequest }
  >;
  register: MutationOptions<
    UploadGrant[],
    ImportScope & { body: SlackRegisterRequest }
  >;
  complete: MutationOptions<
    ImportProgress,
    ImportScope & { body: SlackCompleteRequest }
  >;
  finalize: MutationOptions<ImportProgress, ImportScope>;
  cancel: MutationOptions<ImportProgress, ImportScope>;
};

/** Scope is carried in mutation variables, not read later from a changing team signal. */
export function slackImportMutationOptions(
  client: SlackImportClient,
  cache: QueryClient
): ImportMutationOptions {
  function updated(_: unknown, scope: ImportScope): void {
    // Cache work must not turn a successful write into a failed command.
    void invalidateSlackImport(cache, scope);
  }
  return {
    create: {
      mutationFn: async (args: { teamId: string; body: SlackCreateRequest }) =>
        throwOnErr(() => client.createSlackImport({ body: args.body })),
      onSuccess: (job: ImportProgress, args: { teamId: string }) =>
        updated(job, { teamId: args.teamId, jobId: job.jobId }),
    },
    register: {
      mutationFn: async (
        args: ImportScope & { body: SlackRegisterRequest }
      ) => {
        if (args.body.descriptors.length > MAX_UPLOAD_BATCH) {
          throw new Error('Slack import registration exceeds the batch limit');
        }
        return throwOnErr(() =>
          client.registerSlackImportUploads({
            jobId: args.jobId,
            body: args.body,
          })
        );
      },
    },
    complete: {
      mutationFn: async (
        args: ImportScope & { body: SlackCompleteRequest }
      ) => {
        if (args.body.uploads.length > MAX_UPLOAD_BATCH) {
          throw new Error('Slack import completion exceeds the batch limit');
        }
        return throwOnErr(() =>
          client.completeSlackImportUploads({
            jobId: args.jobId,
            body: args.body,
          })
        );
      },
      onSuccess: updated,
    },
    finalize: {
      mutationFn: async (args: ImportScope) =>
        throwOnErr(() => client.finalizeSlackImport({ jobId: args.jobId })),
      onSuccess: updated,
    },
    cancel: {
      mutationFn: async (args: ImportScope) =>
        throwOnErr(() => client.cancelSlackImport({ jobId: args.jobId })),
      onSuccess: updated,
    },
  };
}
