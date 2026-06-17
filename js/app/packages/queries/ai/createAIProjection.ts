import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type {
  AiProjectionExpiry,
  AiProjectionRefreshCadence,
  AiProjectionResponse,
  AiProjectionTarget,
  MaterializeAIProjectionRequest,
} from '@service-storage/generated/schemas';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export type TargetType = 'user' | 'team';

export type Target<T extends TargetType = TargetType> = {
  type: T;
  id: string;
};

export type RefreshCadence = AiProjectionRefreshCadence;
export type Expiry = AiProjectionExpiry;

export type AIProjectionStatus =
  | 'loading'
  | 'cold'
  | 'ready'
  | 'refreshing'
  | 'error';

export type AIProjectionParser<T> = (data: string) => T;

export type EnabledInput = boolean | Accessor<boolean>;

export type CreateAIProjectionParams<T = string> = {
  id: string;
  prompt: string;
  target: Target;
  refreshCadence: RefreshCadence;
  expiry?: Expiry;
  context?: string | null;
  schema?: unknown;
  enabled?: EnabledInput;
  parser?: AIProjectionParser<T>;
};

export type AIProjectionState<T> = {
  status: Accessor<AIProjectionStatus>;
  loading: Accessor<boolean>;
  cold: Accessor<boolean>;
  ready: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  hasError: Accessor<boolean>;
  data: Accessor<T | undefined>;
  error: Accessor<unknown | undefined>;
  generatedAt: Accessor<Date | undefined>;
  staleAt: Accessor<Date | undefined>;
  refetch: () => Promise<void>;
};

export type AIProjectionQueryData<T> = {
  status: Exclude<AIProjectionStatus, 'loading'>;
  data: T | undefined;
  error: string | undefined;
  generatedAt: Date | undefined;
  staleAt: Date | undefined;
};

export type AIProjectionQueryKey = readonly [
  'aiProjection',
  {
    id: string;
    target: Target;
    prompt: string;
    context: string | null;
    schema: string;
  },
];

const AI_PROJECTION_POLL_INTERVAL_MS = 2_000;
const UNDEFINED_KEY_PART = '__macro_ai_projection_undefined__';

type JsonObject = Record<string, unknown>;

export function target<T extends TargetType>(type: T, id: string): Target<T> {
  return { type, id };
}

function readEnabled(enabled: EnabledInput | undefined): boolean {
  if (enabled === undefined) {
    return true;
  }

  return typeof enabled === 'function' ? enabled() : enabled;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])])
  );
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return UNDEFINED_KEY_PART;
  }

  const serialized = JSON.stringify(stableJsonValue(value));
  return serialized ?? String(value);
}

function toQueryTarget(projectionTarget: Target): Target {
  return { type: projectionTarget.type, id: projectionTarget.id };
}

export function createAIProjectionQueryKey<T>(
  params: CreateAIProjectionParams<T>
): AIProjectionQueryKey {
  return [
    'aiProjection',
    {
      id: params.id,
      target: toQueryTarget(params.target),
      prompt: params.prompt,
      context: params.context ?? null,
      schema: stableStringify(params.schema),
    },
  ];
}

function toServiceTarget(projectionTarget: Target): AiProjectionTarget {
  switch (projectionTarget.type) {
    case 'user':
      return { type: 'user', id: projectionTarget.id };
    case 'team':
      return { type: 'team', id: projectionTarget.id };
  }
}

function createMaterializeRequest<T>(
  params: CreateAIProjectionParams<T>,
  forceRefresh: boolean
): MaterializeAIProjectionRequest {
  const request: MaterializeAIProjectionRequest = {
    id: params.id,
    target: toServiceTarget(params.target),
    prompt: params.prompt,
    refreshCadence: params.refreshCadence,
  };

  if (params.context !== undefined) {
    request.context = params.context;
  }

  if (params.expiry !== undefined) {
    request.expiry = params.expiry;
  }

  if (params.schema !== undefined) {
    request.schema = params.schema;
  }

  if (forceRefresh) {
    request.forceRefresh = true;
  }

  return request;
}

function parseDate(value: string | null | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

function parseProjectionData<T>(
  response: AiProjectionResponse,
  parser: AIProjectionParser<T> | undefined
): T | undefined {
  if (response.status === 'cold' || response.data == null) {
    return undefined;
  }

  if (parser) {
    return parser(response.data);
  }

  return response.data as T;
}

function mapProjectionResponse<T>(
  response: AiProjectionResponse,
  parser: AIProjectionParser<T> | undefined
): AIProjectionQueryData<T> {
  return {
    status: response.status,
    data: parseProjectionData(response, parser),
    error: response.error ?? undefined,
    generatedAt: parseDate(response.generatedAt),
    staleAt: parseDate(response.staleAt),
  };
}

function shouldPoll<T>(data: AIProjectionQueryData<T> | undefined): boolean {
  return data?.status === 'cold' || data?.status === 'refreshing';
}

async function materializeProjection<T>(
  params: CreateAIProjectionParams<T>,
  forceRefresh: boolean
): Promise<AIProjectionQueryData<T>> {
  const response = await throwOnErr(() =>
    storageServiceClient.materializeAIProjection(
      createMaterializeRequest(params, forceRefresh)
    )
  );

  return mapProjectionResponse(response, params.parser);
}

export function createAIProjection<T = string>(
  params: CreateAIProjectionParams<T>
): AIProjectionState<T> {
  const queryClient = useQueryClient();
  const queryKey = createAIProjectionQueryKey(params);

  const query = useQuery(() => ({
    queryKey,
    queryFn: async () => await materializeProjection(params, false),
    enabled: readEnabled(params.enabled),
    refetchInterval: (query) =>
      shouldPoll(query.state.data) ? AI_PROJECTION_POLL_INTERVAL_MS : false,
  }));

  const status = (): AIProjectionStatus => {
    if (query.isLoading && query.data === undefined) {
      return 'loading';
    }

    if (query.isError) {
      return 'error';
    }

    return query.data?.status ?? 'loading';
  };

  return {
    status,
    loading: () => status() === 'loading',
    cold: () => status() === 'cold',
    ready: () => status() === 'ready',
    refreshing: () => status() === 'refreshing',
    hasError: () => status() === 'error',
    data: () => query.data?.data,
    error: () => query.error ?? query.data?.error,
    generatedAt: () => query.data?.generatedAt,
    staleAt: () => query.data?.staleAt,
    refetch: async () => {
      const data = await materializeProjection(params, true);
      queryClient.setQueryData(queryKey, data);
    },
  };
}
