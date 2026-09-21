import {
  type Accessor,
  type Component,
  createContext,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  type Signal,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createSplitRouter } from './router';
import {
  resolveRouteBranch,
  routeParams,
  type SplitRoutesManifest,
} from './routes';
import type {
  InferSplitRouteBranchParams,
  InferSplitRouteParams,
  SplitNavigate,
  SplitNavigateOptions,
  SplitNavigateTo,
  SplitRouteParams,
  SplitRouter as SplitRouterController,
  SplitRouterExternalLocation,
  SplitRouterLayout,
  SplitRouterMiddleware,
  SplitRouteState,
  SplitRoutes,
} from './types';
import { reactiveRecord } from './utils';

type UnknownSplitRouter = SplitRouterController<unknown>;

export type SplitRouterContextValue = {
  router: UnknownSplitRouter;
  globalRevision: Accessor<number>;
  track: (splitId: unknown) => void;
};

type SplitRouterOutletContextValue = {
  splitId: Accessor<unknown>;
  depth: Accessor<number>;
};

export const SplitRouterContext = createContext<SplitRouterContextValue>();
export const SplitRouterScopeContext = createContext<Accessor<unknown>>();
const SplitRouterOutletContext = createContext<SplitRouterOutletContextValue>();

function useSplitRouterContext() {
  const context = useContext(SplitRouterContext);

  if (!context) {
    throw new Error(
      'Split router hooks must be used inside <SplitRouter.Root>'
    );
  }

  return context;
}

export function useSplitRouter<TSplitId>(): SplitRouterController<TSplitId> {
  return useSplitRouterContext()
    .router as unknown as SplitRouterController<TSplitId>;
}

export function useSplitRouterState<TSplitId>() {
  const context = useSplitRouterContext();
  const router = context.router as unknown as SplitRouterController<TSplitId>;

  return {
    router,
    canGo(splitId: TSplitId, delta: number) {
      context.track(splitId);

      return router.canGo(splitId, delta);
    },
    history(splitId: TSplitId) {
      context.track(splitId);

      return router.history(splitId);
    },
    route(splitId: TSplitId) {
      context.track(splitId);

      return router.route(splitId);
    },
    location(splitId: TSplitId) {
      context.track(splitId);

      return router.location(splitId);
    },
    search(splitId: TSplitId, namespace: string) {
      context.track(splitId);

      return router.search(splitId, namespace);
    },
  };
}

export function useSplitRouterScope<TSplitId>(): Accessor<TSplitId> {
  const splitId = useContext(SplitRouterScopeContext);

  if (!splitId) {
    throw new Error(
      'Split router hooks must be used inside <SplitRouter.Scope> or <SplitRouter.Outlet>'
    );
  }

  return splitId as Accessor<TSplitId>;
}

export function useNavigate<TSplitId = unknown>(): SplitNavigate<TSplitId> {
  const router = useSplitRouter<TSplitId>();
  const splitId = useSplitRouterScope<TSplitId>();

  const navigate = router.navigate as (
    splitId: TSplitId,
    to: SplitNavigateTo,
    options?: SplitNavigateOptions<TSplitId>
  ) => void;

  return ((to: SplitNavigateTo, options: SplitNavigateOptions<TSplitId> = {}) =>
    navigate(splitId(), to, options)) as SplitNavigate<TSplitId>;
}

export function useCanGo(delta: number): Accessor<boolean> {
  const router = useSplitRouterState<unknown>();
  const splitId = useSplitRouterScope<unknown>();

  return () => router.canGo(splitId(), delta);
}

export function useSplitHistory() {
  const router = useSplitRouterState<unknown>();
  const splitId = useSplitRouterScope<unknown>();

  return () => router.history(splitId());
}

export function useParams<const TRoute extends { id: string }>(
  route: TRoute
): InferSplitRouteBranchParams<TRoute>;
export function useParams<T extends SplitRouteParams = SplitRouteParams>(): T;
export function useParams(through?: { id: string }): SplitRouteParams {
  const router = useSplitRouterState<unknown>();
  const splitId = useSplitRouterScope<unknown>();
  const params = createMemo(() => {
    const route = router.route(splitId());
    if (!through || !route) return routeParams(route);
    const index = route.matches.findIndex((match) => match.id === through.id);
    if (index < 0) return {};
    const [first, ...rest] = route.matches;
    return routeParams({ matches: [first, ...rest.slice(0, index)] });
  });

  return reactiveRecord(params);
}

export function useRouteParams<const TRoute extends { id: string }>(
  route: TRoute
): InferSplitRouteParams<TRoute> {
  const router = useSplitRouterState<unknown>();
  const splitId = useSplitRouterScope<unknown>();
  const params = createMemo(
    () =>
      router.route(splitId())?.matches.find((match) => match.id === route.id)
        ?.params ?? {}
  );

  return reactiveRecord(params) as InferSplitRouteParams<TRoute>;
}

export type SplitRouterRootProps<TSplitId, TComponent = unknown> = {
  layout: SplitRouterLayout<TSplitId>;
  routes: SplitRoutes<TComponent> | SplitRoutesManifest<TComponent>;
  location: SplitRouterExternalLocation;
  middleware?: readonly SplitRouterMiddleware[];
  children?: JSX.Element;
};

export function Root<TSplitId, TComponent = unknown>(
  props: SplitRouterRootProps<TSplitId, TComponent>
) {
  const router = createSplitRouter({
    layout: props.layout,
    routes: props.routes,
    location: props.location,
    middleware: props.middleware,
  });
  const [globalRevision, setGlobalRevision] = createSignal(0);
  const splitRevisions = new Map<unknown, Signal<number>>();
  const splitRevision = (splitId: unknown) => {
    let revision = splitRevisions.get(splitId);

    if (!revision) {
      revision = createSignal(0);
      splitRevisions.set(splitId, revision);
    }

    return revision;
  };

  router.subscribe((splitId) => {
    if (splitId === undefined) {
      setGlobalRevision((value) => value + 1);
      return;
    }

    splitRevision(splitId)[1]((value) => value + 1);
  });
  onCleanup(() => router.dispose());

  const ready = () => {
    globalRevision();

    return router.isReady();
  };

  return (
    <SplitRouterContext.Provider
      value={{
        router: router as unknown as SplitRouterController<unknown>,
        globalRevision,
        track: (splitId) => {
          globalRevision();
          splitRevision(splitId)[0]();
        },
      }}
    >
      <Show when={ready()}>{props.children}</Show>
    </SplitRouterContext.Provider>
  );
}

export type SplitRouterScopeProps<TSplitId> = {
  splitId: TSplitId;
  children?: JSX.Element;
};

export function Scope<TSplitId>(props: SplitRouterScopeProps<TSplitId>) {
  return (
    <SplitRouterScopeContext.Provider value={() => props.splitId}>
      {props.children}
    </SplitRouterScopeContext.Provider>
  );
}

export type SplitRouterOutletProps<TSplitId> = {
  splitId?: TSplitId;
  fallback?: () => JSX.Element;
};

export function Outlet<TSplitId>(props: SplitRouterOutletProps<TSplitId>) {
  const context = useSplitRouterContext();
  const parent = useContext(SplitRouterOutletContext);
  const scope = useContext(SplitRouterScopeContext);
  const splitId: Accessor<unknown> = () => {
    if (props.splitId !== undefined) return props.splitId;
    if (parent) return parent.splitId();
    if (scope) return scope();

    throw new Error(
      'SplitRouter.Outlet requires a splitId or <SplitRouter.Scope>'
    );
  };
  const startDepth = () =>
    props.splitId === undefined && parent ? parent.depth() : 0;
  const route = (): SplitRouteState | undefined => {
    context.track(splitId());
    return context.router.route(splitId());
  };
  const resolved = createMemo(() => {
    const currentRoute = route();
    if (!currentRoute) return;
    const branch = resolveRouteBranch(context.router.routes, currentRoute);

    for (let index = startDepth(); index < branch.length; index += 1) {
      const definition = branch[index]?.definition;
      const component = definition?.component;
      if (definition && typeof component === 'function') {
        const remountKey = definition.remountKey?.(
          currentRoute.matches[index]!.params
        );

        return {
          component: component as Component,
          renderKey: JSON.stringify([definition.id, remountKey ?? null]),
          nextDepth: index + 1,
        };
      }
    }
  });
  const component = () => resolved()?.component;
  const renderKey = () => resolved()?.renderKey;
  const outletContext: SplitRouterOutletContextValue = {
    splitId,
    depth: () => resolved()?.nextDepth ?? startDepth(),
  };
  const Fallback = () => props.fallback?.();

  return (
    <SplitRouterScopeContext.Provider value={splitId}>
      <Show keyed when={renderKey()} fallback={<Fallback />}>
        {(_key) => (
          <SplitRouterOutletContext.Provider value={outletContext}>
            <Dynamic component={component()} />
          </SplitRouterOutletContext.Provider>
        )}
      </Show>
    </SplitRouterScopeContext.Provider>
  );
}

export const SplitRouter = {
  Root,
  Scope,
  Outlet,
};
