/**
 * @vitest-environment jsdom
 */

// The one difference the differential finds: reading the options of a
// definition the viewer cannot see. REST answered 404, which safeFetch turns
// into a ThrownResultError NOT_FOUND; GraphQL answers "property definition is
// not visible", which `toQueryError` (property-catalog.ts) passes on as the
// CombinedError. This reproduces it with nothing but that read, through the
// real options query on each side and the app's real retry policy, and checks
// that every field a caller of `usePropertyOptionsQuery` reads is the same.
//
// Run from apps/web:
//   bunx vitest run --config src/lib/queries/vitest.config.ts --maxWorkers 2 src/proof/property-catalog/opts-error.test.tsx

import {
  type ResultError,
  thrownResultErrorHasCode,
  throwOnErr,
} from '@core/util/result';
import { until } from '@solid-primitives/promise';
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
  useQuery,
} from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { err, type Result } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ executeQuery: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => network,
}));
const rest = vi.hoisted(() => ({
  getPropertyOptions:
    vi.fn<
      (args: {
        definition_id: string;
      }) => Promise<Result<PropertyOption[], ResultError<string>[]>>
    >(),
}));
vi.mock('@service-properties/client', () => ({
  propertiesServiceClient: rest,
}));

let appClient: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return appClient;
  },
}));

import { propertiesKeys } from '@queries/properties/keys';
import { usePropertyOptionsQuery } from '@queries/properties/options';
import { usablePropertyOptions } from '@queries/properties/options-data';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';

const HIDDEN = '00000000-0000-4000-8000-00000000dead';
// The query client's retry policy, verbatim from src/lib/queries/client.ts.
// That module starts persistence and the normalizer on import, so it is not
// imported here; `retry-policy matches` below reads its source to keep the
// copy honest.
const retry = (failureCount: number, error: unknown) => {
  if (
    thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
    thrownResultErrorHasCode(error, 'FORBIDDEN')
  ) {
    return false;
  }
  return failureCount < 1;
};

// The base commit's options query: options.ts differs from it only in this
// queryFn (git diff a03c481f726 HEAD -- apps/web/src/lib/queries/properties/options.ts).
const EMPTY_OPTIONS: PropertyOption[] = [];
function oldPropertyOptionsQueryOptions(propertyDefinitionId: string) {
  return queryOptions({
    queryKey: propertiesKeys.options({ propertyDefinitionId }).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        rest.getPropertyOptions({ definition_id: propertyDefinitionId })
      ),
    enabled: true,
    staleTime: 1000 * 60 * 5,
    placeholderData: EMPTY_OPTIONS,
  });
}

let dispose: (() => void) | undefined;
function mount<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={appClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

type OptionsQuery = ReturnType<typeof usePropertyOptionsQuery>;
// Everything the callers read: SelectEditor.tsx (usablePropertyOptions,
// isLoading), routine-event-property.tsx (isSuccess ? data : [], isError),
// AI tool Properties.tsx (data ?? []), plus the query state they derive from.
function callerView(q: OptionsQuery) {
  return {
    selectEditorOptions: usablePropertyOptions(q, []),
    selectEditorLoading: q.isLoading,
    routineOptions: q.isSuccess ? q.data : [],
    routineFailed: q.isError,
    aiToolOptions: q.data ?? [],
    status: q.status,
    fetchStatus: q.fetchStatus,
    isPlaceholderData: q.isPlaceholderData,
    failureCount: q.failureCount,
  };
}

async function settled(q: OptionsQuery) {
  await until(() => q.fetchStatus === 'idle' && q.status !== 'pending');
  return { view: callerView(q), error: q.error };
}

beforeEach(() => {
  appClient = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 0 } },
  });
  network.executeQuery.mockReset();
  rest.getPropertyOptions.mockReset();
  // REST: the properties service's 404, as safeFetch maps it.
  rest.getPropertyOptions.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
  );
  // GraphQL: the resolver's error for a definition the viewer cannot see
  // (crates/graphql_properties/src/definitions.rs).
  network.executeQuery.mockImplementation(() => ({
    toPromise: async () => ({
      data: undefined,
      error: new CombinedError({
        graphQLErrors: [{ message: 'property definition is not visible' }],
        response: { status: 200 },
      }),
    }),
  }));
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  appClient.clear();
});

it('reads a hidden definition the same way for every caller, with a different error', async () => {
  const old = await settled(
    mount(() => useQuery(() => oldPropertyOptionsQueryOptions(HIDDEN)))
  );
  dispose?.();
  appClient.clear();
  const neu = await settled(mount(() => usePropertyOptionsQuery(() => HIDDEN)));

  // The difference, at the data level.
  expect(thrownResultErrorHasCode(old.error, 'NOT_FOUND')).toBe(true);
  expect(neu.error).toBeInstanceOf(CombinedError);
  expect(String(neu.error?.message)).toBe(
    '[GraphQL] property definition is not visible'
  );
  // Both were retried once (one retry each): the same retry decision.
  expect(rest.getPropertyOptions).toHaveBeenCalledTimes(2);
  expect(network.executeQuery).toHaveBeenCalledTimes(2);
  // And nothing a caller reads differs.
  expect(neu.view).toEqual(old.view);
  expect(neu.view).toEqual({
    selectEditorOptions: [],
    selectEditorLoading: false,
    routineOptions: [],
    routineFailed: true,
    aiToolOptions: [],
    status: 'error',
    fetchStatus: 'idle',
    isPlaceholderData: false,
    failureCount: 2,
  });
});

it('retry policy matches src/lib/queries/client.ts', async () => {
  const { readFileSync } = await import('node:fs');
  // vitest runs from apps/web
  const source = readFileSync('src/lib/queries/client.ts', 'utf8').replace(
    /\s+/g,
    ' '
  );
  expect(source).toContain(
    "retry: (failureCount, error) => { if ( thrownResultErrorHasCode(error, 'UNAUTHORIZED') || thrownResultErrorHasCode(error, 'FORBIDDEN') ) { return false; } return failureCount < 1; },"
  );
  // Neither the client nor the options query sets a retry delay, so TanStack's
  // default (1,000 ms before the first retry) applies, as the settle test uses.
  expect(source).not.toContain('retryDelay');
  expect(
    readFileSync('src/lib/queries/properties/options.ts', 'utf8')
  ).not.toMatch(/retry\s*:|retryDelay/);
});

// The fresh-mount settle timeouts the load runs show. A cold mount of the
// options query for a hidden definition fails, waits TanStack's first retry
// delay (1,000 ms, the app sets none of its own), and fails again, so it
// settles only after two round trips plus 1 s. The harness gives a cold mount
// 5,000 ms (harness.tsx, `settle`), so round trips of 2 s or more time it
// out, on either side: this runs both with every request answered after
// LATENCY_MS.
const LATENCY_MS = 2100;
it('needs two round trips plus the 1 s retry delay to settle a hidden definition, on both sides', async () => {
  appClient = new QueryClient({ defaultOptions: { queries: { retry } } });
  // each call's start and answer, to show the wait between them
  const calls: { start: number; answered: number }[] = [];
  const late = <T,>(value: T) => {
    const call = { start: performance.now(), answered: Infinity };
    calls.push(call);
    return new Promise<T>((resolve) =>
      setTimeout(() => {
        call.answered = performance.now();
        resolve(value);
      }, LATENCY_MS)
    );
  };
  rest.getPropertyOptions.mockImplementation(() =>
    late(err([{ code: 'NOT_FOUND', message: 'Resource not found' }]))
  );
  network.executeQuery.mockImplementation(() => ({
    toPromise: () =>
      late({
        data: undefined,
        error: new CombinedError({
          graphQLErrors: [{ message: 'property definition is not visible' }],
          response: { status: 200 },
        }),
      }),
  }));
  const time = async (q: OptionsQuery) => {
    const start = performance.now();
    await settled(q);
    return performance.now() - start;
  };
  const oldMs = await time(
    mount(() => useQuery(() => oldPropertyOptionsQueryOptions(HIDDEN)))
  );
  const oldCalls = calls.splice(0);
  dispose?.();
  appClient.clear();
  const neuMs = await time(mount(() => usePropertyOptionsQuery(() => HIDDEN)));
  const neuCalls = calls.splice(0);
  for (const [first, second] of [oldCalls, neuCalls]) {
    // the retry went out TanStack's 1 s after the first answer
    expect(second.start - first.answered).toBeGreaterThanOrEqual(1000 - 20);
    expect(second.start - first.answered).toBeLessThan(1000 + 400);
  }
  for (const ms of [oldMs, neuMs]) {
    expect(ms).toBeGreaterThanOrEqual(2 * LATENCY_MS + 1000 - 20);
    expect(ms).toBeGreaterThan(5000);
  }
  expect(rest.getPropertyOptions).toHaveBeenCalledTimes(2);
  expect(network.executeQuery).toHaveBeenCalledTimes(2);
}, 30000);
