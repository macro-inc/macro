import {
  invalidateSlackImport,
  parseSlackImportUpdate,
  type SlackImportClient,
  slackImportJobOptions,
  slackImportListOptions,
  slackImportMutationOptions,
} from '@queries/slack-import';
import type { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { ImportLimits as WireLimits } from '@service-storage/generated/schemas/importLimits';
import type { ImportProgress } from '@service-storage/generated/schemas/importProgress';
import type { uploadSlackImport } from '@service-storage/slack-import-upload';
import { type QueryClient, useMutation, useQuery } from '@tanstack/solid-query';
import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import {
  type ImportCommands,
  type ImportJob,
  type ImportLimits,
  type ImportSource,
  type ImportSourceInputs,
  ImportUploadError,
} from '../context/contracts';

export type ImportSourceDependencies = {
  client: SlackImportClient;
  queryClient: QueryClient;
  /** Supply the existing generic gateway effect from the app-facing entry point. */
  gatewayEffect: typeof createConnectionWebsocketEffect;
  upload: typeof uploadSlackImport;
};

function toLimits(limits: WireLimits): ImportLimits {
  return {
    conversations: limits.conversations,
    jsonBytes: limits.jsonBytes,
    selectedBytes: limits.selectedBytes,
    zipEntries: limits.zipEntries,
    partBytes: limits.partBytes,
    partRecords: limits.partRecords,
    recordBytes: limits.recordBytes,
    registrationBatch: limits.registrationBatch,
  };
}

export function toImportJob(teamId: string, job: ImportProgress): ImportJob {
  return {
    teamId,
    source: { ...job.source },
    includeMessageHistory: job.includeMessageHistory,
    jobId: job.jobId,
    status: job.status,
    revision: job.revision,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    registrationClosed: job.registrationClosedAt != null,
    usersVerified: job.usersVerified,
    limits: toLimits(job.limits),
    conversations: job.conversations.map((conversation) => ({
      slackChannelId: conversation.slackChannelId,
      name: conversation.name,
      kind: conversation.kind,
      archived: conversation.archived,
      channelId:
        conversation.status === 'skipped'
          ? undefined
          : (conversation.channelId ?? undefined),
      status: conversation.status,
      counters: { ...conversation.counters },
      partCount: conversation.partCount ?? undefined,
      verifiedParts: conversation.verifiedParts,
      searchStatus: conversation.search.status,
      error: conversation.error ?? undefined,
      warnings: [...conversation.warnings],
    })),
  };
}

/** Construct under the consuming Solid owner; no production services are imported at runtime. */
export function createImportSource(
  dependencies: ImportSourceDependencies,
  inputs: ImportSourceInputs
): { source: ImportSource; commands: ImportCommands } {
  const { client, queryClient, gatewayEffect, upload } = dependencies;
  let disposed = false;
  const scope = createMemo(() => ({
    teamId: inputs.teamId(),
    enabled: inputs.enabled(),
  }));
  const enabled = () => !disposed && scope().enabled && Boolean(scope().teamId);
  const activeUploads = new Set<AbortController>();
  function abortUploads(): void {
    for (const controller of activeUploads) controller.abort();
    activeUploads.clear();
  }
  onCleanup(() => {
    disposed = true;
    abortUploads();
  });

  const pageQuery = useQuery(
    () =>
      slackImportListOptions(
        client,
        inputs.teamId() ?? '',
        enabled(),
        inputs.before?.()
      ),
    () => queryClient
  );
  const jobQuery = useQuery(
    () =>
      slackImportJobOptions(
        client,
        { teamId: inputs.teamId() ?? '', jobId: inputs.jobId() ?? '' },
        enabled()
      ),
    () => queryClient
  );

  createEffect(
    on(scope, () => {
      onCleanup(abortUploads);
      if (!enabled()) return;
      gatewayEffect((message) => {
        if (!enabled() || message.type !== 'slack_import_updated') return;
        const event = parseSlackImportUpdate(message.data);
        if (!event || event.teamId !== inputs.teamId()) return;
        void invalidateSlackImport(queryClient, event);
      });
    })
  );

  const page = createMemo(() => {
    if (!enabled() || !(pageQuery.isSuccess || pageQuery.isRefetchError))
      return undefined;
    const data = pageQuery.data;
    if (!data?.value || !data.teamId || data.teamId !== inputs.teamId())
      return undefined;
    const page = data.value;
    const teamId = data.teamId;
    return {
      jobs: page.jobs.map((job) => toImportJob(teamId, job)),
      limits: toLimits(page.limits),
      sourceBinding: { ...page.sourceBinding },
      nextCursor: page.nextCursor ?? undefined,
    };
  });
  const job = createMemo(() => {
    if (
      !enabled() ||
      !inputs.jobId() ||
      !(jobQuery.isSuccess || jobQuery.isRefetchError)
    )
      return undefined;
    const data = jobQuery.data;
    if (
      !data?.value ||
      !data.teamId ||
      data.teamId !== inputs.teamId() ||
      data.value.jobId !== inputs.jobId()
    )
      return undefined;
    return toImportJob(data.teamId, data.value);
  });
  const source: ImportSource = {
    page: () => (enabled() ? page() : undefined),
    job: () => (enabled() ? job() : undefined),
    isLoading: () =>
      enabled() &&
      ((pageQuery.isPlaceholderData && pageQuery.isFetching) ||
        (jobQuery.isPlaceholderData && jobQuery.isFetching)),
    error: () =>
      enabled() ? (pageQuery.error ?? jobQuery.error ?? undefined) : undefined,
    async refresh() {
      if (!enabled()) return;
      await Promise.all([
        pageQuery.refetch({ throwOnError: true }),
        ...(inputs.jobId() ? [jobQuery.refetch({ throwOnError: true })] : []),
      ]);
    },
  };

  const options = slackImportMutationOptions(client, queryClient);
  const create = useMutation(
    () => options.create,
    () => queryClient
  );
  const register = useMutation(
    () => options.register,
    () => queryClient
  );
  const complete = useMutation(
    () => options.complete,
    () => queryClient
  );
  const finalize = useMutation(
    () => options.finalize,
    () => queryClient
  );
  const cancel = useMutation(
    () => options.cancel,
    () => queryClient
  );

  function requireScope(teamId: string): () => void {
    const started = scope();
    function check(): void {
      if (!enabled() || started !== scope() || teamId !== inputs.teamId()) {
        throw new Error('Slack import scope is no longer active');
      }
    }
    check();
    return check;
  }

  const commands: ImportCommands = {
    async create(teamId, body) {
      const check = requireScope(teamId);
      const job = await create.mutateAsync({ teamId, body });
      check();
      return toImportJob(teamId, job);
    },
    async register(identity, descriptors) {
      const check = requireScope(identity.teamId);
      const grants = await register.mutateAsync({
        ...identity,
        body: { descriptors },
      });
      check();
      return grants.map((grant) => ({
        descriptor: {
          ...grant.descriptor,
          upload: { ...grant.descriptor.upload },
        },
        expiresAt: grant.expiresAt,
        async put(blob, options) {
          check();
          const controller = new AbortController();
          activeUploads.add(controller);
          try {
            const signal = options?.signal
              ? AbortSignal.any([options.signal, controller.signal])
              : controller.signal;
            const result = await upload(grant, blob, { ...options, signal });
            check();
            if (result.isErr()) {
              const error = result.error;
              throw new ImportUploadError(
                error.code,
                error.code === 'HTTP_ERROR' ? error.status : undefined
              );
            }
            return result.value;
          } finally {
            activeUploads.delete(controller);
          }
        },
      }));
    },
    async complete(identity, uploads, seal) {
      const check = requireScope(identity.teamId);
      const job = await complete.mutateAsync({
        ...identity,
        body: { uploads, seal },
      });
      check();
      return toImportJob(identity.teamId, job);
    },
    async finalize(identity) {
      const check = requireScope(identity.teamId);
      const job = await finalize.mutateAsync(identity);
      check();
      return toImportJob(identity.teamId, job);
    },
    async cancel(identity) {
      const check = requireScope(identity.teamId);
      const job = await cancel.mutateAsync(identity);
      check();
      return toImportJob(identity.teamId, job);
    },
  };
  return { source, commands };
}
