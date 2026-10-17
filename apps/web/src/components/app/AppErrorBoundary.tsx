import { analytics } from '@app/lib/analytics';
import { Telemetry } from '@macro-inc/observability';
import RefreshIcon from '@phosphor/arrow-clockwise.svg';
import WarningIcon from '@phosphor/warning.svg';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  ErrorBoundary,
  on,
  type ParentProps,
} from 'solid-js';

type AppErrorBoundaryProps = ParentProps<{
  /** Names the boundary in error reports. */
  name: string;
  /** Clears the error when it changes, so navigating away recovers. */
  resetKey: Accessor<unknown>;
}>;

type AppErrorFallbackProps = Omit<AppErrorBoundaryProps, 'children'> & {
  error: unknown;
  reset: () => void;
};

function AppErrorFallback(props: AppErrorFallbackProps) {
  // The boundary stops the error before the global handlers that report it.
  Telemetry.error(props.error, { boundary: props.name });
  analytics.posthog.captureException(props.error, { boundary: props.name });
  createEffect(on(props.resetKey, () => props.reset(), { defer: true }));

  return (
    <div
      role="alert"
      class="flex size-full min-h-0 flex-1 items-center justify-center p-6 font-sans"
    >
      <div class="flex max-w-sm flex-col items-center gap-3 text-center">
        <WarningIcon class="size-6 text-failure" />
        <p class="text-sm font-medium text-ink">Something went wrong</p>
        <p class="text-xs leading-5 text-ink-muted">
          This view hit an error. Try again, or go somewhere else in the app.
        </p>
        <Button variant="outline" size="sm" onClick={() => props.reset()}>
          <RefreshIcon class="size-3.5" />
          Try again
        </Button>
      </div>
    </div>
  );
}

/**
 * Shows a recoverable error in place of a view that failed to render, so one
 * broken view leaves the rest of the app usable instead of blank.
 */
export function AppErrorBoundary(props: AppErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <AppErrorFallback
          name={props.name}
          resetKey={props.resetKey}
          error={error}
          reset={reset}
        />
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}
