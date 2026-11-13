import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { TraceFlow } from '@app/observability/flow';
import { enableAgentDashboards } from '@core/constant/featureFlags';
import { cn } from '@ui';
import {
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
  useContext,
} from 'solid-js';

/**
 * Whether panes draw compact: set by a dense grid for its children, and by a
 * pane's own `dense`, which wins.
 */
const DenseContext = createContext(false);

export function DenseScope(props: ParentProps<{ dense: boolean | undefined }>) {
  const inherited = useContext(DenseContext);
  return (
    <DenseContext.Provider value={props.dense ?? inherited}>
      {props.children}
    </DenseContext.Provider>
  );
}

/** A pane's density: its own flag, else the enclosing grid's. */
export function usePaneDense(dense: () => boolean | undefined): () => boolean {
  const inherited = useContext(DenseContext);
  return () => dense() ?? inherited;
}

/**
 * The frame every data pane shares: a bordered card with its title, filling
 * the grid cell it sits in.
 */
export function Pane(
  props: ParentProps<{
    title?: string;
    dense: boolean;
    /** Names the pane for assistive technology when it has no title. */
    label: string;
    trailing?: JSX.Element;
    class?: string;
  }>
) {
  return (
    <section
      aria-label={props.title ?? props.label}
      data-dynamic-ui-pane
      class={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink',
        props.dense ? 'gap-1.5 p-2' : 'gap-2.5 p-3',
        props.class
      )}
    >
      <Show when={props.title || props.trailing}>
        <div class="flex min-w-0 flex-none items-center gap-2">
          <span
            class={cn(
              'min-w-0 flex-1 truncate font-medium text-ink',
              props.dense ? 'text-xs' : 'text-sm'
            )}
          >
            {props.title}
          </span>
          {props.trailing}
        </div>
      </Show>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
    </section>
  );
}

/** A quiet line in place of a pane's data: no access, an error, empty. */
export function PaneMessage(props: { children: JSX.Element; dense?: boolean }) {
  return (
    <p
      role="status"
      class={cn(
        'flex flex-1 items-center justify-center text-center text-ink-muted',
        props.dense ? 'py-2 text-xs' : 'py-4 text-sm'
      )}
    >
      {props.children}
    </p>
  );
}

/**
 * Error codes that mean the viewer may not read what a pane shows: services
 * hide what a viewer may not read behind 404, and a source may be gone.
 */
export const NO_ACCESS_CODES: readonly string[] = [
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'GONE',
];

/** What a pane shows when its viewer cannot read its source. */
export function NoAccess(props: { dense?: boolean }) {
  return (
    <PaneMessage dense={props.dense}>{t('dynamicUi.noAccess')}</PaneMessage>
  );
}

/** A pane's place while it loads. */
export function PaneLoading(props: { dense?: boolean }) {
  return (
    <div role="status" aria-label={t('dynamicUi.loading')} class="flex flex-1">
      <ListSkeleton.Bar
        class={cn('w-full rounded-md', props.dense ? 'h-8' : 'h-16')}
      />
    </div>
  );
}

/**
 * Dashboard layouts and panes only render with agent dashboards on. Off, a
 * neutral placeholder takes their place, so a view holding them still draws
 * everything else; while the flag loads, nothing does, never the off path.
 */
export function DashboardsOnly(props: ParentProps) {
  const flag = useFeatureFlag(enableAgentDashboards);
  return (
    <Show when={!flag().loading}>
      <Show
        when={flag().enabled}
        fallback={
          <div class="rounded-xl border border-dashed border-edge-muted px-3 py-2 text-xs text-ink-muted">
            {t('dynamicUi.unavailable')}
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  );
}

/** How far below the viewport a pane starts loading. */
const LOAD_AHEAD = '200px';

/**
 * Mounts its children once the pane nears the viewport, so a long dashboard
 * runs only the queries someone scrolls to. Without IntersectionObserver
 * (tests, old engines) it mounts at once.
 */
export function WhenVisible(props: ParentProps<{ dense: boolean }>) {
  const [visible, setVisible] = createSignal(
    typeof IntersectionObserver === 'undefined'
  );
  let element: HTMLDivElement | undefined;
  onMount(() => {
    if (visible() || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: LOAD_AHEAD }
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div ref={element} class="flex h-full min-h-0 min-w-0 flex-col">
      <Show when={visible()} fallback={<PaneLoading dense={props.dense} />}>
        {props.children}
      </Show>
    </div>
  );
}

/**
 * A data pane: gated by the flag, loaded when scrolled to, and traced as its
 * own phase (`dynamic_ui.pane.<type>`) of the view or dashboard loading it.
 * Attributes are the ids a reader searches by, never content.
 */
export function DataPane(
  props: ParentProps<{
    type: 'stat' | 'chart' | 'table' | 'savedView';
    dense: boolean;
    attributes: Record<string, string>;
  }>
) {
  return (
    <DashboardsOnly>
      <WhenVisible dense={props.dense}>
        <TraceFlow
          name={`dynamic_ui.pane.${props.type}`}
          // A pane pointed at another source in place loads anew.
          key={() => JSON.stringify(props.attributes)}
          attributes={{ 'pane.type': props.type, ...props.attributes }}
        >
          <Suspense fallback={<PaneLoading dense={props.dense} />}>
            {props.children}
          </Suspense>
        </TraceFlow>
      </WhenVisible>
    </DashboardsOnly>
  );
}
