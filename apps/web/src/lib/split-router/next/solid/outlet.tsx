import {
  type Component,
  createMemo,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type OutletMatch, outletAt } from '../routes/queries';
import type { PaneId } from '../routes/types';
import {
  PaneContext,
  type PaneContextValue,
  usePaneContext,
  useSplitRouter,
} from './context';
import { PaneScope } from './pane-scope';

type OutletFallback = JSX.Element | (() => JSX.Element);

export type OutletProps = {
  /** Shorthand for wrapping this outlet in `<SplitRouter.Scope pane={…}>`. */
  pane?: PaneId;
  /** Shown when nothing below this point in the branch has a component. */
  fallback?: OutletFallback;
};

function RouteOutlet(props: { fallback?: OutletFallback }) {
  const router = useSplitRouter();
  const parent = usePaneContext();

  const fallback = () => {
    const { fallback } = props;
    if (typeof fallback === 'function') return fallback();

    return fallback;
  };

  const match = createMemo<OutletMatch | undefined>(
    () => outletAt(router.routes, parent.entry(), parent.depth()),
    undefined,
    { equals: (left, right) => left?.key === right?.key }
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
          <Dynamic component={resolved.component as Component} />
        </PaneContext.Provider>
      )}
    </Show>
  );
}

/**
 * Renders the next route component in the enclosing pane's branch. Its view
 * stays mounted while its route id and `remountKey` are unchanged; params
 * update in place. Outside any pane it renders the first pane's top-level
 * route, whose component decides how the other panes render.
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
    <Show when={pane()} fallback={<RouteOutlet fallback={props.fallback} />}>
      {(pane) => (
        <PaneScope pane={pane()}>
          <RouteOutlet fallback={props.fallback} />
        </PaneScope>
      )}
    </Show>
  );
}
