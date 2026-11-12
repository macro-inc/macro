import { fireAndForget } from '@core/util/fireAndForget';
import type { UserName } from '@service-auth/generated/schemas/userName';
import {
  hashKey,
  onlineManager,
  type Query,
  type QueryClient,
  skipToken,
} from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createComputed,
  createRoot,
  createSignal,
  getListener,
  getOwner,
  type Owner,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  canonicalContactUserId,
  MAX_CONTACT_ID_BYTES,
} from '../contacts/contact-user-id';
import type { QueryAccount } from './account-scope';
import { authKeys } from './keys';

export const USER_NAME_CACHE_LIMITS = {
  idleEntries: 512,
  idleBytes: 512 * 1024,
  entryBytes: 16 * 1024,
  batch: 500,
  pending: 500,
  freshMs: 10 * 60_000,
  idleMs: 10 * 60_000,
  retryMs: 30_000,
  batchWaitMs: 10,
  requestTimeoutMs: 30_000,
} as const;

export type UserNameState = {
  name?: UserName | null;
  loading: boolean;
  error?: string;
  updatedAt: number;
  retryAt: number;
};
export class UserNameAccessError extends Error {
  constructor() {
    super('Name access changed');
  }
}
export type UserNameBatchReader = (
  account: QueryAccount,
  ids: string[],
  queueWaitMs: number,
  signal: AbortSignal
) => Promise<readonly UserName[]>;

type Entry = {
  id: string;
  query: Query<UserNameState>;
  generation: number;
  version: number;
  pins: number;
  bytes: number;
  touched: number;
  wanted: boolean;
  queuedAt: number;
  unowned: boolean;
  running: boolean;
  released: boolean;
  revision: Accessor<number>;
  notify: () => void;
};
export function normalizeUserNameQueryId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CONTACT_ID_BYTES)
    return null;
  return canonicalContactUserId(value.trim()) ?? null;
}
function sameAccount(
  left: QueryAccount | undefined,
  right: QueryAccount | undefined
) {
  return left?.userId === right?.userId && left?.session === right?.session;
}
function nameBytes(name: UserName | null | undefined, id: string): number {
  return (
    256 +
    2 *
      (id.length +
        (name?.first_name?.length ?? 0) +
        (name?.last_name?.length ?? 0))
  );
}
function boundedName(name: UserName, id: string): UserName | undefined {
  if (name.first_name != null && typeof name.first_name !== 'string') return;
  if (name.last_name != null && typeof name.last_name !== 'string') return;
  if (name.is_agent !== undefined && typeof name.is_agent !== 'boolean') return;
  if (nameBytes(name, id) > USER_NAME_CACHE_LIMITS.entryBytes) return;
  // Copy scalar fields only; never retain a response envelope or query proxy.
  return {
    id,
    first_name: name.first_name,
    last_name: name.last_name,
    is_agent: name.is_agent,
  };
}
/** Admit only scalar labels for this bounded request; one malformed row cannot
 * populate another identity or poison valid rows in the batch. */
function requestedNames(
  names: readonly UserName[],
  requested: ReadonlySet<string>
) {
  if (!Array.isArray(names) || names.length > USER_NAME_CACHE_LIMITS.batch)
    throw new Error('Invalid name batch');
  const found = new Map<string, UserName | undefined>();
  for (const value of names) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string')
      continue;
    const id = normalizeUserNameQueryId(value.id);
    if (!id || !requested.has(id)) continue;
    found.set(id, found.has(id) ? undefined : boundedName(value, id));
  }
  return found;
}

const EMPTY: UserNameState = { loading: false, updatedAt: 0, retryAt: 0 };

/** QueryClient owns the only name values. This controller owns bounded idle
 * metadata, active-reader leases and one physical batch, not a second name store.
 * Active labels scale with live readers, never directory size. */
export function createUserNameCache(options: {
  client: QueryClient;
  account: Accessor<QueryAccount | undefined>;
  fetch: UserNameBatchReader;
  onScopeChange?: () => void;
}) {
  const { client } = options;
  const entries = new Map<string, Entry>();
  const idle = new Map<Entry, number>();
  const pending = new Set<Entry>();
  const leases = new WeakMap<Owner, Set<Entry>>();
  const [scopeRevision, notifyScope] = createSignal(0);
  const [authRevision, notifyAuth] = createSignal(0);
  const authQueryHash = hashKey(authKeys.userInfo.queryKey);
  let account: QueryAccount | undefined;
  let generation = 0;
  let idleBytes = 0;
  let running = false;
  let requestController: AbortController | undefined;
  let inFlightCount = 0;
  let disposed = false;
  let blocked = false;
  let sweepScheduled = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryDueAt = 0;

  function state(entry: Entry): UserNameState {
    return entry.query.state.data ?? EMPTY;
  }
  function removeIdle(entry: Entry) {
    const bytes = idle.get(entry);
    if (bytes === undefined) return;
    idleBytes -= bytes;
    idle.delete(entry);
  }
  function remove(entry: Entry) {
    if (entries.get(entry.id) !== entry) return;
    entries.delete(entry.id);
    pending.delete(entry);
    removeIdle(entry);
    entry.query.setState({ data: undefined, dataUpdatedAt: 0 });
    client.getQueryCache().remove(entry.query);
  }
  function trim() {
    const now = Date.now();
    for (const [entry] of idle) {
      if (entry.pins) {
        removeIdle(entry);
        continue;
      }
      if (
        idle.size <= USER_NAME_CACHE_LIMITS.idleEntries &&
        idleBytes <= USER_NAME_CACHE_LIMITS.idleBytes &&
        now - entry.touched < USER_NAME_CACHE_LIMITS.idleMs
      )
        break;
      remove(entry);
    }
    const oldest = idle.keys().next().value;
    const dueAt = oldest
      ? oldest.touched + USER_NAME_CACHE_LIMITS.idleMs
      : undefined;

    // Reads call this constantly. A pending timer that fires no later than the
    // oldest name is due stays: when it fires it trims and arms the next one.
    if (
      expiryTimer !== undefined &&
      dueAt !== undefined &&
      expiryDueAt <= dueAt
    )
      return;

    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (dueAt === undefined) return;

    expiryDueAt = dueAt;
    expiryTimer = setTimeout(
      () => {
        expiryTimer = undefined;
        trim();
      },
      Math.max(1, dueAt - now)
    );
  }
  function makeIdle(entry: Entry) {
    removeIdle(entry);
    idle.set(entry, entry.bytes);
    idleBytes += entry.bytes;
  }
  function publish(entry: Entry, value: UserNameState) {
    if (
      disposed ||
      entries.get(entry.id) !== entry ||
      entry.generation !== generation
    )
      return;
    entry.query.setData(value);
    entry.bytes = nameBytes(value.name, entry.id);
    const previousBytes = idle.get(entry);
    if (previousBytes !== undefined) {
      idleBytes += entry.bytes - previousBytes;
      idle.set(entry, entry.bytes);
    }
    entry.notify();
  }
  function synchronize() {
    if (disposed) return;
    const next = untrack(options.account);
    if (sameAccount(account, next)) return;
    batch(() => {
      generation++;
      requestController?.abort();
      if (account) options.onScopeChange?.();
      account = next ? { ...next } : undefined;
      blocked = false;
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      flushTimer = undefined;
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      expiryTimer = undefined;
      for (const entry of entries.values()) remove(entry);
      entries.clear();
      idle.clear();
      pending.clear();
      idleBytes = 0;
      notifyScope((value) => value + 1);
    });
  }
  function current(entry: Entry, version: number, scope: number) {
    synchronize();
    return (
      !disposed &&
      generation === scope &&
      entries.get(entry.id) === entry &&
      entry.version === version
    );
  }
  function schedule() {
    if (disposed || blocked || running || flushTimer !== undefined || !account)
      return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      fireAndForget(flush(), 'user-names');
    }, USER_NAME_CACHE_LIMITS.batchWaitMs);
  }
  function fill() {
    // Waiting interests live only on active/bounded-idle entries. No unbounded
    // queue of ids, resolver arrays, or promises is created for overflow.
    for (const entry of entries.values()) {
      if (pending.size === USER_NAME_CACHE_LIMITS.pending) break;
      if (entry.wanted && !entry.running && (entry.pins > 0 || entry.unowned))
        pending.add(entry);
    }
    if (pending.size) schedule();
  }
  async function flush() {
    synchronize();
    if (disposed || blocked || running || !account) return;
    const owner = { ...account };
    const scope = generation;
    const work: { entry: Entry; version: number }[] = [];
    for (const entry of pending) {
      pending.delete(entry);
      if (
        !entry.wanted ||
        (!entry.pins && !entry.unowned) ||
        entries.get(entry.id) !== entry
      )
        continue;
      entry.wanted = false;
      entry.unowned = false;
      entry.running = true;
      work.push({ entry, version: entry.version });
      if (work.length === USER_NAME_CACHE_LIMITS.batch) break;
    }
    if (!work.length) return;
    running = true;
    const controller = new AbortController();
    requestController = controller;
    const deadline = setTimeout(
      () =>
        controller.abort(
          new DOMException('Name request timed out', 'TimeoutError')
        ),
      USER_NAME_CACHE_LIMITS.requestTimeoutMs
    );
    inFlightCount = work.length;
    const requested = new Set(work.map(({ entry }) => entry.id));
    try {
      const queueWaitMs = Math.max(
        0,
        Date.now() - Math.min(...work.map(({ entry }) => entry.queuedAt))
      );
      const names = await options.fetch(
        owner,
        [...requested],
        queueWaitMs,
        controller.signal
      );
      controller.signal.throwIfAborted();
      synchronize();
      if (disposed || scope !== generation) return;
      const found = requestedNames(names, requested);
      for (const { entry } of work) entry.running = false;
      batch(() => {
        for (const { entry, version } of work) {
          if (!current(entry, version, scope)) continue;
          if (found.has(entry.id) && !found.get(entry.id)) {
            failed(entry);
          } else {
            publish(entry, {
              name: found.get(entry.id) ?? null,
              loading: false,
              updatedAt: Date.now(),
              retryAt: Date.now() + USER_NAME_CACHE_LIMITS.freshMs,
            });
          }
        }
      });
    } catch (error) {
      synchronize();
      for (const { entry } of work) entry.running = false;
      batch(() => {
        if (
          error instanceof UserNameAccessError &&
          scope === generation &&
          !disposed
        ) {
          blocked = true;
          pending.clear();
          for (const entry of entries.values()) {
            entry.wanted = false;
            publish(entry, {
              loading: false,
              error: 'Name access changed',
              updatedAt: 0,
              retryAt: Infinity,
            });
          }
        } else {
          for (const { entry, version } of work)
            if (current(entry, version, scope)) failed(entry);
        }
      });
    } finally {
      clearTimeout(deadline);
      requestController = undefined;
      for (const { entry } of work) entry.running = false;
      running = false;
      inFlightCount = 0;
      trim();
      fill();
    }
  }
  function failed(entry: Entry) {
    const previous = state(entry);
    publish(entry, {
      ...previous,
      loading: false,
      error: 'Names unavailable',
      retryAt: Date.now() + USER_NAME_CACHE_LIMITS.retryMs,
    });
  }
  function sweepReleased() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      if (disposed) return;
      for (const entry of entries.values()) {
        if (!entry.released || entry.pins) continue;
        entry.released = false;
        entry.touched = Date.now();
        makeIdle(entry);
        if (!entry.unowned) {
          entry.wanted = false;
          pending.delete(entry);
        }
      }
      trim();
    });
  }
  function pin(entry: Entry, owner: Owner | null) {
    if (!owner) {
      entry.unowned = true;
      entry.released = false;
      return;
    }
    let owned = leases.get(owner);
    if (!owned) {
      owned = new Set();
      const held = owned;
      leases.set(owner, held);
      onCleanup(() => {
        leases.delete(owner);
        for (const item of held) {
          if (entries.get(item.id) !== item) continue;
          item.pins--;
          if (!item.pins) item.released = true;
        }
        held.clear();
        // Solid releases computation cleanup just before reevaluating it. Wait
        // for that synchronous reacquisition before applying idle eviction.
        sweepReleased();
      });
    }
    if (!owned.has(entry)) {
      owned.add(entry);
      entry.pins++;
      entry.released = false;
      removeIdle(entry);
    }
  }
  function entryFor(id: string): Entry | undefined {
    if (!account) return;
    let entry = entries.get(id);
    if (!entry) {
      const key = authKeys.userName(
        account.userId,
        account.session,
        generation,
        id
      ).queryKey;
      // Explicit bounded ownership replaces time-only QueryCache retention.
      const query = client.getQueryCache().build<UserNameState>(client, {
        queryKey: key,
        queryFn: skipToken,
        gcTime: Infinity,
      });
      const [revision, setRevision] = createSignal(0);
      entry = {
        id,
        query,
        generation,
        version: 0,
        pins: 0,
        bytes: nameBytes(undefined, id),
        touched: Date.now(),
        wanted: false,
        queuedAt: Date.now(),
        unowned: false,
        running: false,
        released: false,
        revision,
        notify: () => setRevision((value) => value + 1),
      };
      entries.set(id, entry);
      makeIdle(entry);
    }
    return entry;
  }
  function read(rawId: string): UserNameState {
    synchronize();
    scopeRevision();
    const id = normalizeUserNameQueryId(rawId);
    if (!id || !account || disposed) return EMPTY;
    const entry = entryFor(id);
    if (!entry) return EMPTY;
    pin(entry, getListener() ? getOwner() : null);
    entry.touched = Date.now();
    if (!entry.pins) makeIdle(entry);
    const value = untrack(() => state(entry));
    if (!blocked && Date.now() >= value.retryAt && !entry.running) {
      if (!entry.wanted) entry.queuedAt = Date.now();
      entry.wanted = true;
      if (pending.size < USER_NAME_CACHE_LIMITS.pending) pending.add(entry);
      schedule();
    }
    entry.revision();
    trim();
    return {
      ...value,
      loading: value.name === undefined && (entry.wanted || entry.running),
    };
  }
  function control(rawId: string) {
    synchronize();
    const scope = generation;
    const id = normalizeUserNameQueryId(rawId);
    const owner = account;
    let active = true;
    if (getOwner())
      onCleanup(() => {
        active = false;
      });
    const admitted = () => {
      synchronize();
      return (
        active &&
        !disposed &&
        !blocked &&
        !!owner &&
        !!id &&
        scope === generation &&
        sameAccount(owner, account)
      );
    };
    return {
      refetch() {
        if (!admitted() || !id) return;
        const entry = entryFor(id);
        if (!entry) return;
        entry.touched = Date.now();
        if (!entry.pins) makeIdle(entry);
        entry.version++;
        entry.queuedAt = Date.now();
        entry.wanted = true;
        entry.unowned = true;
        if (pending.size < USER_NAME_CACHE_LIMITS.pending) pending.add(entry);
        schedule();
        trim();
      },
      mutate(value: UserName) {
        if (!admitted() || !id || normalizeUserNameQueryId(value.id) !== id)
          return;
        const name = boundedName(value, id);
        if (!name) return;
        const entry = entryFor(id);
        if (!entry) return;
        entry.touched = Date.now();
        if (!entry.pins) makeIdle(entry);
        entry.version++;
        entry.wanted = false;
        pending.delete(entry);
        publish(entry, {
          name,
          loading: false,
          updatedAt: Date.now(),
          retryAt: Date.now() + USER_NAME_CACHE_LIMITS.freshMs,
        });
        trim();
      },
    };
  }
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'removed' &&
      event.query.queryKey[0] === authKeys.userName._def[0] &&
      event.query.queryKey[1] === authKeys.userName._def[1]
    ) {
      const id = event.query.queryKey.at(-1);
      const entry = typeof id === 'string' ? entries.get(id) : undefined;
      if (entry?.query === event.query) {
        remove(entry);
        entry.notify();
      }
    }
    if (event.query.queryHash === authQueryHash)
      notifyAuth((value) => value + 1);
  });
  const unsubscribeOnline = onlineManager.subscribe((online) => {
    if (!online) return;
    synchronize();
    if (disposed || blocked || !account) return;
    for (const entry of entries.values()) {
      if (!entry.pins || entry.running) continue;
      const value = state(entry);
      if (!value.error && Date.now() < value.retryAt) continue;
      if (!entry.wanted) entry.queuedAt = Date.now();
      entry.wanted = true;
      if (pending.size < USER_NAME_CACHE_LIMITS.pending) pending.add(entry);
    }
    fill();
  });
  const stopScope = createRoot((dispose) => {
    createComputed(() => {
      authRevision();
      options.account();
      untrack(synchronize);
    });
    return dispose;
  }, null);
  return {
    read,
    control,
    inspect: () => ({
      entries: entries.size,
      active: entries.size - idle.size,
      idle: idle.size,
      idleBytes,
      pending: pending.size,
      inFlight: inFlightCount,
    }),
    dispose() {
      disposed = true;
      generation++;
      requestController?.abort();
      unsubscribe();
      unsubscribeOnline();
      stopScope();
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      for (const entry of entries.values()) remove(entry);
      entries.clear();
      idle.clear();
      pending.clear();
      idleBytes = 0;
      notifyScope((value) => value + 1);
    },
  };
}
export type UserNameCache = ReturnType<typeof createUserNameCache>;
