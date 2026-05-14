import { cn } from '@ui';
import { ErrorBoundary, type JSX, Suspense } from 'solid-js';

import { DashboardSectionError } from './dashboard-section-error';
import { DashboardSectionLoading } from './dashboard-section-loading';

interface DashboardSectionProps {
  title: string;
  description?: string;
  children: JSX.Element;
  fallback?: JSX.Element;
  class?: string;
}

export function DashboardSection(props: DashboardSectionProps) {
  return (
    <section
      class={cn(
        'bg-surface border border-edge rounded-lg overflow-hidden',
        props.class
      )}
      aria-labelledby={`section-${props.title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <header class="px-4 py-3 border-b border-edge">
        <h2
          id={`section-${props.title.toLowerCase().replace(/\s+/g, '-')}`}
          class="text-sm font-medium text-ink"
        >
          {props.title}
        </h2>
        {props.description && (
          <p class="text-xs text-ink-muted mt-0.5">{props.description}</p>
        )}
      </header>
      <div class="px-4 py-3">
        <ErrorBoundary
          fallback={(error, reset) => (
            <DashboardSectionError
              error={error}
              reset={reset}
              title={props.title}
            />
          )}
        >
          <Suspense fallback={props.fallback ?? <DashboardSectionLoading />}>
            {props.children}
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  );
}
