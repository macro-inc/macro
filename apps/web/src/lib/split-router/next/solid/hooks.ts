import deepEqual from 'fast-deep-equal';
import { type Accessor, createMemo, untrack, useContext } from 'solid-js';
import type { PendingNavigation } from '../router/runner';
import type {
  NavigationResult,
  RouteMatchInfo,
  SplitNavigateOptions,
} from '../router/types';
import { getRouteEntryState, mergedParams } from '../routes/queries';
import type {
  InferSplitRouteBranchParams,
  InferSplitRouteParams,
  InferSplitRouteState,
  InferSplitRouteStateInput,
  PaneArrival,
  PaneId,
  SplitNavigationTarget,
  SplitRouteNavigationTarget,
  SplitRouteParams,
  SplitRouteReference,
  SplitRouterStateUpdate,
  SplitRouteState,
} from '../routes/types';
import type { MaybePromise } from '../utils';
import { PaneContext, usePaneContext, useSplitRouter } from './context';
import { createMemoRecord } from './memo-record';

export type SplitRouteNavigateOptions<TRoute> = Omit<
  SplitNavigateOptions,
  'state' | 'depth'
> &
  ([InferSplitRouteStateInput<TRoute>] extends [never]
    ? { state?: never }
    : {
        state?: SplitRouterStateUpdate<
          InferSplitRouteStateInput<TRoute>,
          InferSplitRouteState<TRoute>
        >;
      });

export type SplitNavigate = {
  <const TTarget extends { route: SplitRouteReference }>(
    to: TTarget & SplitRouteNavigationTarget<NoInfer<TTarget['route']>>,
    options?: SplitRouteNavigateOptions<TTarget['route']>
  ): MaybePromise<NavigationResult>;
  (
    to: string | number,
    options?: Omit<SplitNavigateOptions, 'depth'>
  ): MaybePromise<NavigationResult>;
};

function depthThrough(
  route: SplitRouteState,
  through: { id: string } | undefined
): number | undefined {
  if (!through) return;

  const index = route.matches.findIndex((match) => match.id === through.id);

  return index + 1;
}

export function usePane(): Accessor<PaneId> {
  return usePaneContext().pane;
}

/** Params merged through `route`, or through the whole branch when omitted. */
export function useParams<const TRoute extends { id: string }>(
  route: TRoute
): InferSplitRouteBranchParams<TRoute>;
export function useParams<T extends SplitRouteParams = SplitRouteParams>(): T;
export function useParams(through?: { id: string }): SplitRouteParams {
  const scope = usePaneContext();

  return createMemoRecord(() => {
    const route = scope.entry()?.location.route;
    if (!route) return {};

    return mergedParams(route, depthThrough(route, through));
  });
}

/** Params owned by `route` alone. */
export function useRouteParams<const TRoute extends { id: string }>(
  route: TRoute
): InferSplitRouteParams<TRoute> {
  const scope = usePaneContext();

  const params = () => {
    const matches = scope.entry()?.location.route.matches;
    const owned = matches?.find((match) => match.id === route.id);

    return owned?.params ?? {};
  };

  return createMemoRecord(params) as InferSplitRouteParams<TRoute>;
}

export function useRouteState<const TRoute extends { id: string }>(
  route: TRoute
): Accessor<InferSplitRouteState<TRoute> | undefined> {
  const router = useSplitRouter();
  const scope = usePaneContext();

  return createMemo(() =>
    getRouteEntryState(router.routes, scope.entry(), route)
  );
}

/** In-memory props handed to this view when it opened; read once at mount. */
export function useEntryProps<T = unknown>(): T | undefined {
  const scope = usePaneContext();

  return untrack(() => scope.entry()?.props) as T | undefined;
}

/** Navigates this pane. Relative paths resolve against the calling route. */
export function useNavigate(): SplitNavigate {
  const router = useSplitRouter();
  const scope = usePaneContext();

  const navigate = (
    to: SplitNavigationTarget | number,
    options: SplitNavigateOptions = {}
  ) => router.navigate(scope.pane(), to, { ...options, depth: scope.depth() });

  return navigate as SplitNavigate;
}

export function useMatches(
  pane?: Accessor<PaneId>
): Accessor<RouteMatchInfo[]> {
  const router = useSplitRouter();
  const scope = useContext(PaneContext);

  const matches = () => {
    const id = pane?.() ?? scope?.pane();
    if (id === undefined) return [];

    return router.matches(id);
  };

  // A search change leaves the matches as they were; readers shouldn't hear of it.
  return createMemo(matches, [], { equals: deepEqual });
}

/** This pane's in-flight navigation and its phase, such as a leave guard awaiting a reply. */
export function usePendingNavigation(): Accessor<
  PendingNavigation | undefined
> {
  const router = useSplitRouter();
  const scope = usePaneContext();

  return () => router.pending(scope.pane());
}

export function useCanGo(delta: number): Accessor<boolean> {
  const router = useSplitRouter();
  const scope = usePaneContext();

  return createMemo(() => router.canGo(scope.pane(), delta));
}

/** How the pane reached its current entry: fresh, back, forward or replace. */
export function useArrival(): Accessor<PaneArrival> {
  const router = useSplitRouter();
  const scope = usePaneContext();

  return createMemo(() => router.arrival(scope.pane()));
}
