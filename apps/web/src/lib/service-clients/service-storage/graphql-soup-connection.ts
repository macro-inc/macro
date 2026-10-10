import { isMobile } from '@core/mobile/isMobile';
import { Telemetry } from '@macro-inc/observability';
import type { FormattedExecutionResult } from 'graphql';
import {
  type Client,
  type ClientOptions,
  createClient,
  type Sink,
  type SubscribePayload,
} from 'graphql-ws';
import { registerGraphqlSoupRealtimeConnection } from './graphql-soup-realtime-session';
import { shouldRetryGraphqlSoupWebSocket } from './graphql-soup-retry';

const AUTH_TIMEOUT_MS = 15_000;
const ACK_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;

type Timer = ReturnType<typeof setTimeout>;
type Subscription = {
  attach(client: Client, attempt: Attempt): void;
  stop?: () => void;
  retry?: Timer;
  failures: number;
  blocked: boolean;
  binding: number;
};
type Attempt = {
  client?: Client;
  timer?: Timer;
  pongTimer?: Timer;
  active: boolean;
  connected: boolean;
};

export type GraphqlSoupConnection = Pick<Client, 'subscribe'> & {
  pause(): void;
  restart(): void;
  dispose(): void;
};

/** Bound request frequency without permanently exhausting recovery attempts. */
function retryDelay(failures: number): number {
  return (
    Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) *
    (0.8 + Math.random() * 0.2)
  );
}

function isRetryableOperationError(error: unknown): boolean {
  return (
    Array.isArray(error) &&
    error.length > 0 &&
    error.every(
      (item: unknown) =>
        item !== null &&
        typeof item === 'object' &&
        'extensions' in item &&
        item.extensions !== null &&
        typeof item.extensions === 'object' &&
        'retryable' in item.extensions &&
        item.extensions.retryable === true
    )
  );
}

/** One transport owner retains urql sinks while sockets/auth attempts are replaced. */
export function createGraphqlSoupConnection(options: {
  resolveUrl(): Promise<string>;
  onConnected(recovered: boolean): void;
  onAuthTimeout?(): void;
  webSocketImpl?: ClientOptions['webSocketImpl'];
}): GraphqlSoupConnection {
  const subscriptions = new Set<Subscription>();
  let attempt: Attempt | undefined;
  let retry: Timer | undefined;
  let failures = 0;
  let paused = false;
  let blocked = false;
  let disposed = false;
  let everConnected = false;
  let disconnectedAt: number | undefined;

  const visible = () => typeof document === 'undefined' || !document.hidden;
  const mobileBackgrounded = () => isMobile() && !visible();
  const current = (candidate: Attempt) =>
    candidate.active && attempt === candidate;
  const hasSubscribers = () =>
    [...subscriptions].some((subscription) => !subscription.blocked);
  const canConnect = () =>
    !disposed &&
    !paused &&
    !blocked &&
    !mobileBackgrounded() &&
    hasSubscribers();

  const report = (
    event: string,
    attributes: Record<string, string | number | boolean>
  ) => {
    // Transport recovery must remain independent of the observability exporter.
    try {
      Telemetry.info(`graphql_soup.ws.${event}`, {
        'ws.retries': failures,
        'ws.visible': visible(),
        ...attributes,
      });
    } catch {}
  };

  async function closeClient(client: Client): Promise<void> {
    try {
      client.terminate();
      await client.dispose();
    } catch {
      report('dispose_failed', {});
    }
  }

  function retireAttempt(): void {
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    const previous = attempt;
    attempt = undefined;
    if (previous) {
      previous.active = false;
      clearTimeout(previous.timer);
      clearTimeout(previous.pongTimer);
    }
    for (const subscription of subscriptions) {
      clearTimeout(subscription.retry);
      subscription.retry = undefined;
      subscription.stop?.();
      subscription.stop = undefined;
    }
    if (previous?.client) void closeClient(previous.client);
  }

  function scheduleRetry(): void {
    if (!canConnect() || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, retryDelay(failures++));
  }

  function fail(candidate: Attempt, error: unknown, phase: string): void {
    if (!current(candidate)) return;
    disconnectedAt ??= Date.now();
    const retryable = shouldRetryGraphqlSoupWebSocket(error);
    const code =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'number'
        ? error.code
        : undefined;
    report('failed', {
      'ws.phase': phase,
      'ws.retryable': retryable,
      ...(code === undefined ? {} : { 'ws.close_code': code }),
    });
    retireAttempt();
    blocked = !retryable;
    scheduleRetry();
  }

  async function connect(): Promise<void> {
    if (!canConnect() || attempt) return;
    const candidate: Attempt = { active: true, connected: false };
    attempt = candidate;
    candidate.timer = setTimeout(() => {
      if (!current(candidate)) return;
      options.onAuthTimeout?.();
      fail(candidate, new Event('error'), 'auth_timeout');
    }, AUTH_TIMEOUT_MS);
    try {
      // graphql-ws 6.2 can strand its connection promise when an async URL
      // resolver rejects. Resolve/catch auth here and pass a concrete URL.
      const url = await options.resolveUrl();
      if (!current(candidate)) return;
      clearTimeout(candidate.timer);
      candidate.timer = setTimeout(() => {
        fail(candidate, { code: 4504 }, 'ack_timeout');
      }, ACK_TIMEOUT_MS);
      candidate.client = createClient({
        url,
        retryAttempts: 0,
        connectionAckWaitTimeout: ACK_TIMEOUT_MS,
        keepAlive: HEARTBEAT_INTERVAL_MS,
        webSocketImpl: options.webSocketImpl,
        on: {
          connected: () => {
            if (!current(candidate)) return;
            candidate.connected = true;
            clearTimeout(candidate.timer);
            const recovered = everConnected;
            everConnected = true;
            report('connected', {
              'ws.recovered': recovered,
              'ws.recovery_ms':
                disconnectedAt === undefined ? 0 : Date.now() - disconnectedAt,
            });
            failures = 0;
            disconnectedAt = undefined;
            // Let graphql-ws send the restored subscriptions before issuing
            // recovery reads: these streams do not replay missed events.
            candidate.timer = setTimeout(() => {
              if (current(candidate)) options.onConnected(recovered);
            }, 0);
          },
          closed: (event) => fail(candidate, event, 'transport'),
          error: (error) => fail(candidate, error, 'transport'),
          ping: (received) => {
            if (
              received ||
              !current(candidate) ||
              candidate.pongTimer !== undefined
            )
              return;
            candidate.pongTimer = setTimeout(() => {
              fail(candidate, { code: 4499 }, 'heartbeat_timeout');
            }, PONG_TIMEOUT_MS);
          },
          pong: (received) => {
            if (!received || !current(candidate)) return;
            clearTimeout(candidate.pongTimer);
            candidate.pongTimer = undefined;
          },
        },
      });
      for (const subscription of subscriptions) {
        if (!subscription.blocked)
          subscription.attach(candidate.client, candidate);
      }
    } catch (error) {
      fail(candidate, error, 'authentication');
    }
  }

  function subscribe<Data = Record<string, unknown>, Extensions = unknown>(
    payload: SubscribePayload,
    sink: Sink<FormattedExecutionResult<Data, Extensions>>
  ): () => void {
    const subscription: Subscription = {
      failures: 0,
      blocked: false,
      binding: 0,
      attach(client, candidate) {
        const binding = ++subscription.binding;
        const attached = () =>
          current(candidate) &&
          subscriptions.has(subscription) &&
          subscription.binding === binding;
        const operationFailed = (error: unknown) => {
          if (!attached()) return;
          subscription.binding += 1;
          const retryable = isRetryableOperationError(error);
          report('subscription_failed', {
            'ws.operation': payload.operationName ?? 'anonymous',
            'ws.retryable': retryable,
          });
          subscription.stop?.();
          subscription.stop = undefined;
          subscription.blocked = !retryable;
          if (retryable) {
            subscription.retry = setTimeout(
              () => {
                subscription.retry = undefined;
                if (current(candidate) && subscriptions.has(subscription)) {
                  subscription.attach(client, candidate);
                }
              },
              retryDelay(subscription.failures++)
            );
          }
        };
        subscription.stop = client.subscribe<Data, Extensions>(payload, {
          next(result) {
            if (!attached()) return;
            if (!result.errors?.length) subscription.failures = 0;
            sink.next(result);
            if (result.errors?.length) operationFailed(result.errors);
          },
          error(error) {
            if (!attached()) return;
            if (!Array.isArray(error)) {
              fail(candidate, error, 'transport');
              return;
            }
            operationFailed(error);
          },
          complete() {
            if (!attached()) return;
            subscriptions.delete(subscription);
            sink.complete();
            if (subscriptions.size === 0) retireAttempt();
          },
        });
      },
    };
    if (disposed) {
      sink.complete();
      return () => {};
    }
    subscriptions.add(subscription);
    if (attempt?.client && !blocked && !paused)
      subscription.attach(attempt.client, attempt);
    else void connect();
    return () => {
      if (!subscriptions.delete(subscription)) return;
      clearTimeout(subscription.retry);
      subscription.stop?.();
      if (subscriptions.size === 0) retireAttempt();
    };
  }

  function wake(): void {
    if (disposed || paused || blocked || mobileBackgrounded()) return;
    if (attempt) return;
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    void connect();
  }

  function visibilityChanged(): void {
    if (!visible()) {
      if (isMobile()) {
        if (attempt?.connected) disconnectedAt ??= Date.now();
        retireAttempt();
      }
      return;
    }
    wake();
  }

  const connection: GraphqlSoupConnection = {
    subscribe,
    pause() {
      paused = true;
      retireAttempt();
    },
    restart() {
      if (disposed) return;
      retireAttempt();
      paused = false;
      blocked = false;
      failures = 0;
      for (const subscription of subscriptions) {
        subscription.blocked = false;
        subscription.failures = 0;
      }
      wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retireAttempt();
      subscriptions.clear();
      unregister();
      if (typeof window !== 'undefined')
        window.removeEventListener('online', wake);
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
  const unregister = registerGraphqlSoupRealtimeConnection(connection);
  if (typeof window !== 'undefined') window.addEventListener('online', wake);
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', visibilityChanged);
  return connection;
}
