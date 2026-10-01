import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { SplitRouter } from '../router/create-router';
import type { Entry, PaneId } from '../routes/types';

const SplitRouterContext = createContext<SplitRouter>();

export function SplitRouterProvider(
  props: ParentProps<{ router: SplitRouter }>
) {
  return (
    <SplitRouterContext.Provider value={props.router}>
      {props.children}
    </SplitRouterContext.Provider>
  );
}

export function useSplitRouter(): SplitRouter {
  const router = useContext(SplitRouterContext);

  if (!router) {
    throw new Error('useSplitRouter must be used inside <SplitRouterProvider>');
  }

  return router;
}

export type PaneContextValue = {
  pane: Accessor<PaneId>;
  entry: Accessor<Entry | undefined>;
  /** Leading matches that belong to the route rendering this subtree. */
  depth: Accessor<number>;
};

export const PaneContext = createContext<PaneContextValue>();

export function usePaneContext(): PaneContextValue {
  const scope = useContext(PaneContext);

  if (!scope) {
    throw new Error(
      'Split router hooks must be used inside a <PaneScope> or an <Outlet pane>'
    );
  }

  return scope;
}
