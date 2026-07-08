import { throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { Expiry } from '@service-cognition/generated/schemas/expiry';
import type { ProjectionStateResponse } from '@service-cognition/generated/schemas/projectionStateResponse';
import type { ProjectionStatus } from '@service-cognition/generated/schemas/projectionStatus';
import type { RefreshCadence } from '@service-cognition/generated/schemas/refreshCadence';
import type { TargetType } from '@service-cognition/generated/schemas/targetType';
import type { UpsertProjectionRequest } from '@service-cognition/generated/schemas/upsertProjectionRequest';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { z } from 'zod';
import { queryClient } from '../client';

const AI_PROJECTION_UPDATED_MESSAGE_TYPE = 'ai_projection_updated';

/** Gateway push sent when a projection materialization finishes (or errors).
 * Mirrors `ProjectionStateResponse` plus the routing discriminators. */
type ProjectionUpdatedMessage = ProjectionStateResponse & {
  type: typeof AI_PROJECTION_UPDATED_MESSAGE_TYPE;
  target_type?: TargetType;
};

export const aiProjectionQueryKey = (id: string, targetType: TargetType) =>
  ['ai-projection', targetType, id] as const;

const GENERATING_STATUSES: ProjectionStatus[] = [
  'cold',
  'loading',
  'refreshing',
];

/** Gateway pushes only land while a subscriber is mounted, so refetch fairly
 * eagerly on remount (the POST is cheap: it returns the server-side cache and
 * bumps the projection's keepalive). */
const PROJECTION_STALE_TIME = 30 * 1000;

export type CreateAIProjectionOptions<Schema extends z.ZodType = z.ZodType> = {
  /** Frontend-defined projection id (e.g. `notification_important_widget`). */
  id: string;
  /** The prompt materialized by the projection. Changing the prompt (or
   * `schema`/`model`) revises the projection server-side and regenerates. */
  prompt: string;
  /** Zod schema for structured output. When set, the projection result is
   * generated as schema-conforming JSON (prompted, non-strict — works across
   * providers) and `data` returns the parsed, validated object. */
  schema?: Schema;
  /** Optional `provider/model` id (e.g. `cerebras/llama-3.3-70b`,
   * `anthropic/claude-haiku-4-5`). Defaults to the server's default model. */
  model?: string;
  /** Whether the projection targets the user or their team. Default `user`. */
  targetType?: TargetType;
  /** Background refresh cadence. Default `medium`. */
  refreshCadence?: RefreshCadence;
  /** How long the projection stays alive without being requested. Default `week`. */
  expiry?: Expiry;
  /** When true, a request that needs generation (cold cache or refresh)
   * generates inline and resolves with the finished result instead of
   * returning immediately and relying on the gateway push. Pair with a fast
   * `model` for interactive use. */
  awaitGeneration?: boolean;
  /** Reactive enabled flag, like tanstack query's. Default true. */
  enabled?: boolean;
};

/** Converts a zod schema into the non-strict JSON schema sent to the server. */
function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'throw',
    cycles: 'throw',
    reused: 'inline',
  }) as Record<string, unknown>;
}

function toProjectionState(
  message: ProjectionUpdatedMessage
): ProjectionStateResponse {
  return {
    id: message.id,
    status: message.status,
    data: message.data,
    error: message.error,
    generated_at: message.generated_at,
    stale_at: message.stale_at,
  };
}

/**
 * Materialized AI projection query, inspired by the Vercel AI SDK's
 * `useObject` but backed by the server-side projection cache.
 *
 * - Upserting is reading: the query POSTs `/ai-projections`, which returns the
 *   cached result when warm and otherwise kicks off (or, with
 *   `awaitGeneration`, awaits) materialization.
 * - Completion updates arrive over the connection gateway
 *   (`ai_projection_updated`) and are written straight into the query cache —
 *   no polling.
 * - `refresh()` re-triggers generation even when a cached result exists; the
 *   stale data stays visible (`status: 'refreshing'`) until the new result
 *   lands.
 *
 * @example
 * ```tsx
 * const projection = createAIProjection(() => ({
 *   id: 'inbox/important',
 *   prompt: 'Summarize my most important unread emails.',
 *   schema: z.object({ items: z.array(z.string()) }),
 *   model: 'cerebras/llama-3.3-70b',
 *   awaitGeneration: true,
 *   enabled: inboxOpen(),
 * }));
 *
 * projection.data()?.items;
 * <Button onClick={() => projection.refresh()} />
 * ```
 */
export function createAIProjection<Schema extends z.ZodType>(
  options: Accessor<CreateAIProjectionOptions<Schema>>
) {
  const targetType = () => options().targetType ?? 'user';
  const queryKey = () => aiProjectionQueryKey(options().id, targetType());

  const buildRequest = (
    overrides?: Partial<UpsertProjectionRequest>
  ): UpsertProjectionRequest => {
    const opts = options();
    return {
      id: opts.id,
      prompt: opts.prompt,
      target_type: targetType(),
      refresh_cadence: opts.refreshCadence ?? 'medium',
      expiry: opts.expiry ?? 'week',
      ...(opts.model === undefined ? {} : { model: opts.model }),
      ...(opts.schema === undefined
        ? {}
        : { output_schema: toOutputSchema(opts.schema) }),
      await: opts.awaitGeneration ?? false,
      ...overrides,
    };
  };

  const query = useQuery(() => ({
    queryKey: queryKey(),
    queryFn: async () =>
      throwOnErr(
        async () =>
          await cognitionApiServiceClient.upsertAiProjection(buildRequest())
      ),
    enabled:
      (options().enabled ?? true) && !!options().id && !!options().prompt,
    staleTime: PROJECTION_STALE_TIME,
  }));

  // Materializations finish out-of-band (SQS worker or refresh sweeps); the
  // gateway pushes the final state, which we write straight into the cache.
  createConnectionWebsocketEffect((message) => {
    if (message.type !== AI_PROJECTION_UPDATED_MESSAGE_TYPE) return;

    let update: ProjectionUpdatedMessage;
    try {
      update = JSON.parse(message.data);
    } catch {
      console.error('unparsable ai projection update payload', message);
      return;
    }

    if (update.id !== options().id) return;
    if ((update.target_type ?? 'user') !== targetType()) return;

    queryClient.setQueryData(queryKey(), toProjectionState(update));
  });

  /** Re-triggers generation even when a cached result exists. Resolves with
   * the post-trigger state (`refreshing`, or the finished result when
   * `awaitGeneration` is set). */
  const refresh = async (): Promise<ProjectionStateResponse> => {
    const key = queryKey();
    const state = await throwOnErr(
      async () =>
        await cognitionApiServiceClient.upsertAiProjection(
          buildRequest({ regenerate: true })
        )
    );
    queryClient.setQueryData(key, state);
    return state;
  };

  /** The projection result: schema-parsed object when a schema is set,
   * otherwise the raw text. Undefined until a result exists (stale results
   * remain visible while refreshing). */
  const data = createMemo((): z.infer<Schema> | string | undefined => {
    const raw = query.data?.data;
    if (raw === null || raw === undefined) return undefined;

    const schema = options().schema;
    if (!schema) return raw;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.error('ai projection result is not valid JSON', error);
      return undefined;
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      console.error(
        'ai projection result failed schema validation',
        parsed.error
      );
      return undefined;
    }
    return parsed.data;
  });

  const status = () => query.data?.status;

  return {
    /** Parsed result (see above). */
    data,
    /** The projection lifecycle status (`cold`/`loading`/`ready`/...). */
    status,
    /** True while the initial fetch or a server-side generation is in flight. */
    isGenerating: () => {
      if (query.isLoading) return true;
      const current = status();
      return current !== undefined && GENERATING_STATUSES.includes(current);
    },
    /** Materialization error (from the projection) or request error message. */
    error: () => query.data?.error ?? query.error?.message ?? undefined,
    /** Re-trigger generation, keeping stale data visible meanwhile. */
    refresh,
    /** The underlying tanstack query, for advanced use. */
    query,
  };
}
