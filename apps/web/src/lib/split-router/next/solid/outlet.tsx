import { type Component, createMemo, type JSX, Show } from 'solid-js';
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

export type OutletProps = {
  /** Shorthand for wrapping this outlet in `<PaneScope pane={…}>`. */
  pane?: PaneId;
  /** Shown when nothing below this point in the branch has a component. */
  fallback?: JSX.Element;
};

function RouteOutlet(props: { fallback?: JSX.Element }) {
  const router = useSplitRouter();
  const parent = usePaneContext();

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
    <Show keyed when={match()} fallback={props.fallback}>
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
 * update in place.
 */
export function Outlet(props: OutletProps) {
  return (
    <Show
      when={props.pane}
      fallback={<RouteOutlet fallback={props.fallback} />}
    >
      {(pane) => (
        <PaneScope pane={pane()}>
          <RouteOutlet fallback={props.fallback} />
        </PaneScope>
      )}
    </Show>
  );
}
