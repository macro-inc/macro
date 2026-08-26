import { nativeNetworkStatus } from '@core/mobile/native-network-status';
import { ThrownResultError } from '@core/util/result';
import { EmptyStatePanel } from '@ui';
import { type Accessor, type JSX, Match, Suspense, Switch } from 'solid-js';
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
          <EmptyStatePanel
            centered
            title={props.loadErrorTitle ?? 'Unable to load this view'}
            description="Check your internet connection and try again."
            primaryAction={
              props.onRetry
                ? { label: 'Retry', onClick: props.onRetry }
                : undefined
            }
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
