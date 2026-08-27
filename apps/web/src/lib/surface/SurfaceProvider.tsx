import {
  type Accessor,
  createContext,
  createEffect,
  type FlowProps,
  type JSX,
  onCleanup,
  untrack,
  useContext,
} from 'solid-js';
import {
  surfaceDirectory as appSurfaceDirectory,
  type SurfaceDirectory,
} from './directory';
import type { MethodsFor, ParamsFor, SurfaceName } from './specs';

/** Context value established by SurfaceProvider for a mounted surface. */
export type SurfaceContextValue<N extends SurfaceName = SurfaceName> = {
  readonly name: N;
  /** Reactive: changes in place on adoptContentId (placeholder → real id). */
  readonly id: Accessor<string>;
  /** Stable accessor over the mount-time params snapshot; never re-fires. */
  readonly params: Accessor<ParamsFor<N> | undefined>;
  /** True when mounted inside another SurfaceProvider (derived from context). */
  readonly nested: boolean;
};

type InternalSurfaceContextValue<N extends SurfaceName = SurfaceName> =
  SurfaceContextValue<N> & {
    directory: SurfaceDirectory;
  };

const SurfaceContext = createContext<InternalSurfaceContextValue>();

function directoryOf(surface: SurfaceContextValue): SurfaceDirectory {
  return (
    (surface as InternalSurfaceContextValue).directory ?? appSurfaceDirectory
  );
}

/**
 * Establishes surface identity, params, and directory announcement for a
 * mount. Renders no DOM of its own.
 */
export function SurfaceProvider<N extends SurfaceName>(
  props: FlowProps<{
    name: N;
    id: Accessor<string>;
    /** One-shot mount params. Snapshotted at setup; never re-read. */
    params?: ParamsFor<N>;
    /** Injectable for tests. Defaults to the app-wide surfaceDirectory. */
    directory?: SurfaceDirectory;
  }>
): JSX.Element {
  const parent = useContext(SurfaceContext);
  const nested = parent !== undefined;
  const directory = untrack(() => props.directory) ?? appSurfaceDirectory;
  const paramsSnapshot: ParamsFor<N> | undefined = untrack(() => {
    const params = props.params;
    if (params === undefined) return undefined;
    return { ...params };
  });

  const value: InternalSurfaceContextValue<N> = {
    name: untrack(() => props.name),
    id: () => props.id(),
    params: () => paramsSnapshot,
    nested,
    directory,
  };

  createEffect(() => {
    if (nested) return;
    const dispose = directory.announce(props.name, props.id());
    onCleanup(dispose);
  });

  return (
    <SurfaceContext.Provider value={value as InternalSurfaceContextValue}>
      {props.children}
    </SurfaceContext.Provider>
  );
}

/**
 * The enclosing surface's context.
 * @throws outside a SurfaceProvider subtree.
 */
export function useSurface(): SurfaceContextValue {
  const ctx = useContext(SurfaceContext);
  if (!ctx) {
    throw new Error('useSurface() called outside a SurfaceProvider');
  }
  return ctx;
}

/** The enclosing surface's context, or undefined outside a provider. */
export function useMaybeSurface(): SurfaceContextValue | undefined {
  return useContext(SurfaceContext);
}

/**
 * Typed params for the named surface. DEV-throws when the enclosing
 * provider's name !== `name` (the cast would be a lie).
 */
export function useSurfaceParams<N extends SurfaceName>(
  name: N
): Accessor<ParamsFor<N> | undefined> {
  const surface = useSurface();
  if (import.meta.env.DEV && surface.name !== name) {
    throw new Error(
      `useSurfaceParams('${name}') called inside surface '${surface.name}'`
    );
  }
  return surface.params as Accessor<ParamsFor<N> | undefined>;
}

/**
 * Register public methods for the enclosing surface. No-op when nested.
 * DEV-throws on name mismatch with the enclosing provider.
 */
export function useSurfaceMethods<N extends SurfaceName>(
  name: N,
  methods: Partial<MethodsFor<N>>
): void {
  const surface = useSurface();
  if (import.meta.env.DEV && surface.name !== name) {
    throw new Error(
      `useSurfaceMethods('${name}') called inside surface '${surface.name}'`
    );
  }
  if (surface.nested) return;
  const directory = directoryOf(surface);
  createEffect(() => {
    const dispose = directory.provide(name, surface.id(), methods);
    onCleanup(dispose);
  });
}
