import { isTransientRequestError } from '@core/util/request-error';
import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { type Client, createRequest } from '@urql/core';

type QueryClient = Pick<Client, 'query'>;
export type ChannelNotificationReader = {
  enabled: boolean;
  fetching: boolean;
  /** Omitted for channel lists, which can gain previously absent channels. */
  channelId?: string;
  filtered: boolean;
  notificationIds: readonly string[];
};
type Waiter = {
  generation: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type Job = {
  query: QueryRevalidation;
  readers: Set<ChannelNotificationReader>;
  generation: number;
  completed: number;
  running: boolean;
  retryAt: number;
  failures: number;
  blocked: boolean;
  waiters: Waiter[];
};

const coordinators = new WeakMap<QueryClient, ChannelNotificationRefresh>();

/** One queue per client; no global notification feed is mounted or inspected. */
export function channelNotificationRefresh(client: QueryClient) {
  let coordinator = coordinators.get(client);
  if (!coordinator) {
    coordinator = new ChannelNotificationRefresh(client);
    coordinators.set(client, coordinator);
  }
  return coordinator;
}

export function disposeChannelNotificationRefresh(client: QueryClient) {
  coordinators.get(client)?.dispose();
  coordinators.delete(client);
}

/** Durable replay falls back to the exchange when no matching reader exists. */
export function delegateChannelNotificationRefresh(
  client: QueryClient,
  query: QueryRevalidation
): boolean {
  return coordinators.get(client)?.invalidateQuery(query) ?? false;
}

export class ChannelNotificationRefresh {
  private jobs = new Map<number, Job>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerAt = 0;
  private active = 0;
  private disposed = false;
  private listening = false;
  private epoch = 0;
  private suspended = false;

  constructor(private readonly client: QueryClient) {}

  register(query: QueryRevalidation, reader: ChannelNotificationReader) {
    const key = createRequest(query.document, query.variables).key;
    let job = this.jobs.get(key);
    if (!job) {
      job = {
        query,
        readers: new Set(),
        generation: 0,
        completed: 0,
        running: false,
        retryAt: 0,
        failures: 0,
        blocked: false,
        waiters: [],
      };
      this.jobs.set(key, job);
    }
    job.readers.add(reader);
    this.listen();
    return () => {
      if (!job.readers.delete(reader)) return;
      if (job.readers.size) return;
      if (!job.running) this.jobs.delete(key);
      job.completed = job.generation;
      this.settle(
        job,
        Infinity,
        new Error('Channel notification reader closed')
      );
      if (![...this.jobs.values()].some((job) => job.readers.size))
        this.stopListening();
    };
  }

  /** Called when reactive enabled/loading state changes; does not invalidate. */
  changed = () => {
    for (const job of this.jobs.values()) {
      if (!this.enabled(job))
        this.settle(
          job,
          Infinity,
          new Error('Channel notification reader disabled')
        );
    }
    this.schedule();
  };

  invalidateQuery(query: QueryRevalidation): boolean {
    const job = this.jobs.get(
      createRequest(query.document, query.variables).key
    );
    if (!job || !this.enabled(job)) return false;
    this.invalidate(job);
    this.schedule();
    return true;
  }

  /** Explicit refreshes await one attempt. Background recovery never fails a mutation. */
  async refresh(queries: readonly QueryRevalidation[]): Promise<void> {
    const jobs = new Set(
      queries
        .map((query) =>
          this.jobs.get(createRequest(query.document, query.variables).key)
        )
        .filter((job): job is Job => !!job && this.enabled(job))
    );
    const promises = [...jobs].map((job) => {
      this.invalidate(job);
      job.blocked = false;
      job.retryAt = 0;
      return new Promise<void>((resolve, reject) => {
        job.waiters.push({ generation: job.generation, resolve, reject });
      });
    });
    this.schedule();
    await Promise.all(promises);
  }

  suspend(suspended: boolean) {
    this.suspended = suspended;
    if (!suspended) this.reconnect();
  }

  /** Fence work from a replaced cache/session while retaining mounted readers. */
  reset() {
    this.epoch += 1;
    for (const job of this.jobs.values()) {
      this.settle(
        job,
        Infinity,
        new Error('Channel notification cache replaced')
      );
      job.failures = 0;
      job.retryAt = 0;
      job.blocked = false;
    }
    this.reconnect();
  }

  reconnect() {
    for (const job of this.jobs.values()) {
      if (this.enabled(job)) this.invalidate(job);
    }
    this.schedule();
  }

  onPatch(patch: GraphqlNotificationPatch, normalized: boolean) {
    if (patch.__typename === 'GraphqlCacheDeletion') {
      if (patch.graphqlTypeName === 'GraphqlNotification') {
        const owners = [...this.jobs.values()].filter((job) =>
          [...job.readers].some((reader) =>
            reader.notificationIds.includes(patch.entityId)
          )
        );
        // A deletion contains no parent channel. Unknown IDs require recovery
        // across enabled readers; known IDs affect only their cached owners.
        for (const job of owners.length ? owners : this.jobs.values()) {
          if (this.enabled(job)) this.invalidate(job);
        }
      } else if (patch.graphqlTypeName === 'GraphqlSoupChannel') {
        this.invalidateChannel(patch.entityId);
      } else return;
    } else {
      if (patch.notification.entityType !== 'CHANNEL') return;
      this.invalidateChannel(
        patch.notification.entityId,
        normalized && patch.__typename === 'GraphqlUpdatedNotification'
          ? patch.notification.id
          : undefined
      );
    }
    this.schedule();
  }

  dispose() {
    this.disposed = true;
    this.stopListening();
    for (const job of this.jobs.values()) {
      this.settle(
        job,
        Infinity,
        new Error('Channel notification client closed')
      );
    }
    this.jobs.clear();
  }

  private enabled(job: Job) {
    return [...job.readers].some((reader) => reader.enabled);
  }

  private invalidate(job: Job) {
    job.generation += 1;
  }

  private invalidateChannel(channelId: string, normalizedUpdateId?: string) {
    for (const job of this.jobs.values()) {
      if (
        [...job.readers].some(
          (reader) =>
            reader.enabled &&
            (!reader.channelId || reader.channelId === channelId) &&
            // Updating a normalized record cannot add it to an older edge.
            (normalizedUpdateId === undefined ||
              reader.filtered ||
              !reader.notificationIds.includes(normalizedUpdateId))
        )
      )
        this.invalidate(job);
    }
  }

  private available(job: Job) {
    return (
      !this.disposed &&
      !this.suspended &&
      this.enabled(job) &&
      !job.running &&
      !job.blocked &&
      job.generation > job.completed &&
      ![...job.readers].some((reader) => reader.enabled && reader.fetching) &&
      // Explicit user refreshes may run in hidden tabs. Background work waits.
      (job.waiters.length > 0 ||
        (!document.hidden && navigator.onLine !== false))
    );
  }

  private schedule = () => {
    if (this.disposed || this.active >= 4) return;
    const ready = [...this.jobs.values()].filter((job) => this.available(job));
    if (!ready.length) return;
    const delay = Math.max(
      100,
      Math.min(...ready.map((job) => job.retryAt)) - Date.now()
    );
    const deadline = Date.now() + delay;
    if (this.timer !== undefined && this.timerAt <= deadline) return;
    clearTimeout(this.timer);
    this.timerAt = deadline;
    this.timer = setTimeout(this.flush, delay);
  };

  private flush = () => {
    this.timer = undefined;
    for (const [key, job] of [...this.jobs]) {
      if (this.active >= 4) break;
      if (!this.available(job) || job.retryAt > Date.now()) continue;
      // Rotate dispatched operations so a busy channel cannot starve others.
      this.jobs.delete(key);
      this.jobs.set(key, job);
      void this.run(key, job);
    }
    this.schedule();
  };

  private async run(key: number, job: Job) {
    const generation = job.generation;
    const epoch = this.epoch;
    job.running = true;
    this.active += 1;
    try {
      const result = await this.client
        .query(job.query.document, job.query.variables, {
          requestPolicy: 'network-only',
        })
        .toPromise();
      if (this.disposed || epoch !== this.epoch || !job.readers.size) return;
      if (result.error) throw result.error;
      job.completed = generation;
      job.failures = 0;
      job.retryAt = 0;
      this.settle(job, generation);
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || !job.readers.size) return;
      job.failures += 1;
      if (error instanceof Error && isTransientRequestError(error)) {
        this.settle(job, generation, error);
        job.retryAt =
          Date.now() +
          Math.min(30_000, 1000 * 2 ** Math.min(job.failures - 1, 5));
      } else {
        job.blocked = true;
        // Later generations cannot run while blocked; reject their callers too.
        this.settle(job, Infinity, error);
      }
      console.warn('Failed to refresh channel notifications', error);
    } finally {
      job.running = false;
      this.active -= 1;
      if (!job.readers.size) this.jobs.delete(key);
      this.schedule();
    }
  }

  private settle(job: Job, generation: number, error?: unknown) {
    const settled = job.waiters.filter(
      (waiter) => waiter.generation <= generation
    );
    job.waiters = job.waiters.filter(
      (waiter) => waiter.generation > generation
    );
    for (const waiter of settled) {
      if (error !== undefined) waiter.reject(error);
      else waiter.resolve();
    }
  }

  private listen() {
    if (this.listening || this.disposed) return;
    this.listening = true;
    document.addEventListener('visibilitychange', this.changed);
    window.addEventListener('online', this.changed);
  }

  private stopListening() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.listening = false;
    document.removeEventListener('visibilitychange', this.changed);
    window.removeEventListener('online', this.changed);
  }
}
