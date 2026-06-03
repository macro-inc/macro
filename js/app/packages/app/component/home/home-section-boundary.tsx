import RefreshIcon from '@phosphor/arrow-clockwise.svg';
import WarningIcon from '@phosphor/warning.svg';
import { Button } from '@ui';
import {
  createSignal,
  ErrorBoundary,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';

interface HomeSectionBoundaryProps {
  title: string;
  children: JSX.Element;
  fallback?: JSX.Element;
}

interface HomeSectionErrorProps {
  error: Error;
  reset: () => void;
  title?: string;
}

function HomeSectionError(props: HomeSectionErrorProps) {
  const [showDetails, setShowDetails] = createSignal(false);

  return (
    <div class="rounded-xl border border-edge-muted bg-surface p-4">
      <div class="flex items-start gap-3">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-failure/10 text-failure [&_svg]:size-4">
          <WarningIcon />
        </div>

        <div class="min-w-0 flex flex-1 flex-col">
          <p class="text-sm font-medium text-ink">
            {props.title
              ? `Failed to load ${props.title}`
              : 'Something went wrong'}
          </p>
          <p class="text-xs leading-5 text-ink-muted">
            We couldn’t load this section. Try again, or view details if the
            issue continues.
          </p>

          <Show when={showDetails()}>
            <p class="mt-2 break-words rounded-lg bg-hover/50 p-2 text-xs leading-5 text-ink-extra-muted">
              {props.error.message}
            </p>
          </Show>

          <div class="mt-2 flex gap-2">
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="w-fit bg-surface"
              onClick={props.reset}
            >
              <RefreshIcon class="size-3.5" />
              Try again
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails((value) => !value)}
              class="w-fit"
            >
              {showDetails() ? 'Hide details' : 'Show details'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeSectionFallback() {
  return (
    <div class="space-y-3">
      <div class="skeleton-shimmer h-4 w-32 rounded-full bg-ink/10" />
      <div class="space-y-2">
        <div class="skeleton-shimmer h-12 rounded-xl bg-hover/60" />
        <div class="skeleton-shimmer h-12 rounded-xl bg-hover/40" />
      </div>
    </div>
  );
}

export function HomeSectionBoundary(props: HomeSectionBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <HomeSectionError
          error={error instanceof Error ? error : new Error(String(error))}
          reset={reset}
          title={props.title}
        />
      )}
    >
      <Suspense fallback={props.fallback ?? <HomeSectionFallback />}>
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}
