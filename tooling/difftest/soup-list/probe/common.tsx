/**
 * Shared probe runtime, served by each app's own Vite server (old = main,
 * new = the PR branch). It mounts real hooks under the app's own QueryClient
 * and returns plain, JSON-safe snapshots for the driver to compare.
 *
 * Nothing here decides equality: the driver normalizes and diffs.
 */
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { type Accessor, type JSX, untrack } from 'solid-js';
import { render } from 'solid-js/web';

export type Snapshot = {
  /** The reader has an answer and is not refetching. */
  settled: boolean;
  /** Reader-level data (every field). */
  data: unknown;
  /** Caller-level output (what the caller shows or decides). */
  caller: unknown;
  status: Record<string, unknown>;
};

type Mounted = { snapshot: () => Snapshot; dispose: () => void };
const mounted = new Map<string, Mounted>();

/**
 * Quick Access stand-in for hooks that read it (the email mention). Identical
 * on both sides: the cache bucket is never the source, so the mention lists
 * the Soup reader under test.
 */
const quickAccessStub = {
  interactionForUser: () => undefined,
  useList: () => ({
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    loadMore: async () => {},
  }),
  usesRecordSelection: () => false,
  usesSearchProjection: () => false,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  // biome-ignore lint/suspicious/noExplicitAny: test stand-in
} as any;

/** Converts reactive values to JSON-safe data: Maps, Sets, Dates, functions. */
export function plain(value: unknown, depth = 0): unknown {
  if (depth > 40) return '[depth]';
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map)
    return Object.fromEntries(
      [...value.entries()].map(([k, v]) => [String(k), plain(v, depth + 1)])
    );
  if (value instanceof Set) return [...value].map((v) => plain(v, depth + 1));
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  if (typeof value === 'function') return '[fn]';
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object)) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = plain(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function mountWith(
  key: string,
  build: () => Accessor<Snapshot>,
  options: { quickAccess?: boolean } = {}
): void {
  unmount(key);
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.append(host);
  let read: Accessor<Snapshot> | undefined;
  function Inner(): JSX.Element {
    read = build();
    return null;
  }
  const dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        {options.quickAccess ? (
          <UserContextProvider>
            <EmailLinksContextProvider>
              <ChannelsContextProvider>
                <QuickAccessContextProvider value={quickAccessStub}>
                  <Inner />
                </QuickAccessContextProvider>
              </ChannelsContextProvider>
            </EmailLinksContextProvider>
          </UserContextProvider>
        ) : (
          <Inner />
        )}
      </QueryClientProvider>
    ),
    host
  );
  mounted.set(key, {
    snapshot: () => {
      if (!read) throw new Error(`probe ${key} did not mount`);
      const value = untrack(read);
      return plain(value) as Snapshot;
    },
    dispose: () => {
      dispose();
      host.remove();
    },
  });
}

export function snapshot(key: string): Snapshot {
  const entry = mounted.get(key);
  if (!entry) throw new Error(`no probe ${key}`);
  return entry.snapshot();
}

export function unmount(key: string): void {
  mounted.get(key)?.dispose();
  mounted.delete(key);
}

export function unmountAll(): void {
  for (const key of [...mounted.keys()]) unmount(key);
}

export function mountedKeys(): string[] {
  return [...mounted.keys()];
}

export async function flushTelemetry(): Promise<void> {
  await Telemetry.flush();
}

/** An error as a stable string, without stack or request ids. */
export function errorText(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
