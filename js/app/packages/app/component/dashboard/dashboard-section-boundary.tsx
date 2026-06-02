import { ErrorBoundary, type JSX, Suspense } from 'solid-js';
import { DashboardSectionError } from './dashboard-section-error';

interface DashboardSectionBoundaryProps {
  title: string;
  children: JSX.Element;
  fallback?: JSX.Element;
}

function DashboardSectionFallback() {
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

export function DashboardSectionBoundary(props: DashboardSectionBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <DashboardSectionError
          error={error instanceof Error ? error : new Error(String(error))}
          reset={reset}
          title={props.title}
        />
      )}
    >
      <Suspense fallback={props.fallback ?? <DashboardSectionFallback />}>
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}
