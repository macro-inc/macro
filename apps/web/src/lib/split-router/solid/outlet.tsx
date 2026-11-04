import { TraceFlow } from '@app/observability/flow';
import { perfMark } from '@app/observability/perf-marks';
import { trackRouteView } from '@app/observability/runtime-resources';
import {
  type Component,
  createEffect,
  createMemo,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type OutletMatch, outletAt, routeParams } from '../routes/queries';
import type { PaneId } from '../routes/types';
import {
  PaneContext,
  type PaneContextValue,
  usePaneContext,
  useSplitRouter,
} from './context';
import { PaneScope } from './pane-scope';

type OutletFallback = JSX.Element | (() => JSX.Element);

function renderFallback(fallback: OutletFallback | undefined): JSX.Element {
  return typeof fallback === 'function' ? fallback() : fallback;
}

export type OutletProps = {
  /** Shorthand for wrapping this outlet in `<SplitRouter.Scope pane={…}>`. */
  pane?: PaneId;
  /** Shown when no root pane exists or the branch has no further component. */
  fallback?: OutletFallback;
};

function RouteOutlet(props: { fallback?: OutletFallback }) {
  const router = useSplitRouter();
  const parent = usePaneContext();

  const fallback = () => renderFallback(props.fallback);

  const match = createMemo<OutletMatch | undefined>(
    () => outletAt(router.routes, parent.entry(), parent.depth()),
    undefined,
    { equals: (left, right) => left?.key === right?.key }
  );

  createEffect(
    on(match, (resolved) => {
      if (resolved)
        perfMark('route.matched', {
          route: resolved.key,
          depth: resolved.depth,
        });
    })
  );

  const context: PaneContextValue = {
    pane: parent.pane,
    entry: parent.entry,
    depth: () => match()?.depth ?? parent.depth(),
  };

  return (
    <Show keyed when={match()} fallback={fallback()}>
      {(resolved) => (
        <PaneContext.Provider value={context}>
          {/* Only routes with their own loading view get a boundary, so the
              rest suspend to their enclosing boundary as before. The flow
              sits inside it: Solid defers its mount until the view resolves. */}
          <Show
            when={resolved.loading as Component | undefined}
            fallback={<RouteView match={resolved} />}
          >
            {(loading) => (
              <Suspense fallback={<Dynamic component={loading()} />}>
                <RouteView match={resolved} />
              </Suspense>
            )}
          </Show>
          <RouteMounted route={resolved.key} />
        </PaneContext.Provider>
      )}
    </Show>
  );
}

/**
 * A route's view, timed from creation until it and its loads have painted.
 * Params at or above this depth update the view in place; the flow starts
 * again for each, so loads after an in-place navigation are timed too.
 */
function RouteView(props: { match: OutletMatch }) {
  onCleanup(trackRouteView());
  const pane = usePaneContext();
  const params = () =>
    JSON.stringify(
      routeParams(pane.entry()?.location.route, props.match.depth)
    );

  return (
    <TraceFlow
      name={`view.${props.match.route}`}
      attributes={{
        'route.id': props.match.route,
        'route.depth': props.match.depth,
      }}
      key={params}
    >
      <Dynamic component={props.match.component as Component} />
    </TraceFlow>
  );
}

/** Marks when a matched route's component tree has been created and attached. */
function RouteMounted(props: { route: string }) {
  onMount(() => perfMark('route.mounted', { route: props.route }));
  return null;
}

/**
 * Renders the next route component in the enclosing pane's branch. Its view
 * stays mounted while its route id (or shared `mountKey`) and `remountKey` are
 * unchanged; params update in place. Outside any pane it renders the first
 * pane's top-level route, whose component decides how the other panes render.
 */
export function Outlet(props: OutletProps) {
  const router = useSplitRouter();
  const enclosing = useContext(PaneContext);

  const pane = () => {
    if (props.pane) return props.pane;
    if (enclosing) return;

    return router.panes()[0];
  };

  return (
    <Show
      when={pane()}
      fallback={
        enclosing ? (
          <RouteOutlet fallback={props.fallback} />
        ) : (
          renderFallback(props.fallback)
        )
      }
    >
      {(pane) => (
        <PaneScope pane={pane()}>
          <RouteOutlet fallback={props.fallback} />
        </PaneScope>
      )}
    </Show>
  );
}
