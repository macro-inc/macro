import { nativeNetworkStatus } from '@core/mobile/native-network-status';
import { ThrownResultError } from '@core/util/result';
import { EmptyStatePanel } from '@ui';
import {
  type Accessor,
  createEffect,
  type JSX,
  Match,
  on,
  onCleanup,
  Suspense,
  Switch,
} from 'solid-js';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { LoadingBlock } from './LoadingBlock';

export type EntityLoadErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'GONE';

/**
 * `LOAD_FAILED` is any non-structural failure — a transport error or an
 * offline load with nothing cached. Unlike the structural codes it is
 * retryable, so the gate renders it with a Retry action when the consumer
 * provides `onRetry` — and loaded content outranks it: when `data` is
 * available the gate renders the content instead, so consumers can pass the
 * normalized error of a failed background refresh without unmounting an
 * already-rendered entity. The structural codes stay authoritative even over
 * loaded data (a revoked entity must not keep rendering its cached copy).
 */
export type EntityLoadError = EntityLoadErrorCode | 'LOAD_FAILED';

export type EntityLoadResult<Data> = {
  data: Accessor<Data | undefined>;
  error: Accessor<EntityLoadError | undefined>;
  isPending: Accessor<boolean>;
};

type EntityLoadGateProps<Data> = {
  result: EntityLoadResult<Data>;
  /** Refetch handler for the `LOAD_FAILED` state's Retry action. */
  onRetry?: () => void;
  /** Entity-specific title for the `LOAD_FAILED` state. */
  loadErrorTitle?: string;
  children: JSX.Element;
};

const ENTITY_LOAD_ERROR_CODES: ReadonlySet<string> = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'GONE',
]);

function isEntityLoadErrorCode(code: string): code is EntityLoadErrorCode {
  return ENTITY_LOAD_ERROR_CODES.has(code);
}

/** Normalizes a query error into the error states supported by the gate. */
export function toEntityLoadError(error: unknown): EntityLoadError | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string' && isEntityLoadErrorCode(error)) return error;
  if (error instanceof ThrownResultError) {
    return (
      error.errors.map(({ code }) => code).find(isEntityLoadErrorCode) ??
      'LOAD_FAILED'
    );
  }
  return 'LOAD_FAILED';
}

/** Delay between regaining native connectivity and the automatic retry. */
const RECONNECT_AUTO_RETRY_DELAY_MS = 2_000;

/**
 * The retryable load-failure panel. While it is on screen, regaining native
 * connectivity retries automatically shortly after the reconnect — the moment
 * a retry is most likely to succeed — instead of waiting for the button. The
 * Retry action is hidden while the device is offline: a manual retry can't
 * succeed, a paused load resumes by itself on reconnect, and a failed one is
 * covered by the automatic retry.
 */
export function LoadErrorPanel(props: {
  title?: string;
  onRetry?: () => void;
}) {
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRetryTimer = () => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  // Deferred: only a transition observed while this panel is showing counts
  // as a reconnect. Mounting while already online means the failure wasn't
  // connectivity (e.g. a server error), which must not self-retry.
  createEffect(
    on(
      nativeNetworkStatus,
      (status) => {
        clearRetryTimer();
        if (status !== 'online') return;
        retryTimer = setTimeout(
          () => props.onRetry?.(),
          RECONNECT_AUTO_RETRY_DELAY_MS
        );
      },
      { defer: true }
    )
  );
  onCleanup(clearRetryTimer);

  return (
    <EmptyStatePanel
      centered
      title={props.title ?? 'Unable to load this view'}
      description="Check your internet connection and try again."
      primaryAction={
        props.onRetry && nativeNetworkStatus() !== 'offline'
          ? { label: 'Retry', onClick: props.onRetry }
          : undefined
      }
    />
  );
}

/** Renders entity content or the appropriate loading and access-error view. */
export function EntityLoadGate<Data>(props: EntityLoadGateProps<Data>) {
  const error = props.result.error;
  const hasData = () => props.result.data() !== undefined;

  return (
    <Suspense fallback={<LoadingBlock />}>
      <Switch
        fallback={
          <div class="flex flex-col items-center justify-center h-full text-lg">
            Sorry, an unexpected error has occurred.
          </div>
        }
      >
        <Match when={error() === 'UNAUTHORIZED' || error() === 'FORBIDDEN'}>
          <Unauthorized />
        </Match>
        <Match when={error() === 'NOT_FOUND'}>
          <NotFound />
        </Match>
        <Match when={error() === 'GONE'}>
          <Gone />
        </Match>
        {/* LOAD_FAILED is retryable, so loaded content outranks it — with
            data available it falls through to the content match below. An
            offline device with nothing to show also lands here: its query
            may be paused rather than errored and would otherwise pend
            forever. */}
        <Match
          when={
            !hasData() &&
            (error() === 'LOAD_FAILED' || nativeNetworkStatus() === 'offline')
          }
        >
          <LoadErrorPanel
            title={props.loadErrorTitle}
            onRetry={props.onRetry}
          />
        </Match>
        <Match when={props.result.isPending()}>
          <LoadingBlock />
        </Match>
        <Match when={hasData()}>{props.children}</Match>
      </Switch>
    </Suspense>
  );
}
