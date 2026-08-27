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
export type SurfaceContextValue = {
  /** Reactive: changes in place on adoptContentId (placeholder → real id). */
  readonly id: Accessor<string>;
  /** Stable accessor over the mount-time params snapshot; never re-fires. */
  readonly params: Accessor<Record<string, unknown> | undefined>;
  /** True when mounted inside another SurfaceProvider (derived from context). */
  readonly nested: boolean;
};

type InternalSurfaceContextValue = SurfaceContextValue & {
  directory: SurfaceDirectory;
};

const SurfaceContext = createContext<InternalSurfaceContextValue>();

function directoryOf(surface: SurfaceContextValue): SurfaceDirectory {
  return (
    (surface as InternalSurfaceContextValue).directory ?? appSurfaceDirectory
  );
}

/**
 * Establishes surface identity and params for a mount, and carries the
 * directory used by useSurfaceMethods. Renders no DOM of its own. Takes no
 * `name`: the mount creator only has runtime content.type, so identity is the
 * id; the typed edge is consumer-side (useSurfaceParams / useSurfaceMethods).
 */
export function SurfaceProvider(
  props: FlowProps<{
    id: Accessor<string>;
    /** One-shot mount params. Snapshotted at setup; never re-read. */
    params?: Record<string, unknown>;
    /** Injectable for tests. Defaults to the app-wide surfaceDirectory. */
    directory?: SurfaceDirectory;
  }>
): JSX.Element {
  const parent = useContext(SurfaceContext);
  const nested = parent !== undefined;
  const directory = untrack(() => props.directory) ?? appSurfaceDirectory;
  const paramsSnapshot: Record<string, unknown> | undefined = untrack(() => {
    const params = props.params;
    if (params === undefined) return undefined;
    return { ...params };
  });

  const value: InternalSurfaceContextValue = {
    id: () => props.id(),
    params: () => paramsSnapshot,
    nested,
    directory,
  };

  return (
    <SurfaceContext.Provider value={value}>
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
 * Typed params for the enclosing surface. `N` is a compile-time witness; the
 * cast is unchecked at runtime (the surface component names its own N — the
 * same trust the legacy BlockComponentProps lookup extended).
 */
export function useSurfaceParams<N extends SurfaceName>(): Accessor<
  ParamsFor<N> | undefined
> {
  return useSurface().params as Accessor<ParamsFor<N> | undefined>;
}

/**
 * Register public methods for the enclosing surface. No-op when nested.
 * Pass `N` explicitly to register surface-specific methods; without it,
 * inference falls back to the shared methods.
 */
export function useSurfaceMethods<N extends SurfaceName = SurfaceName>(
  methods: Partial<MethodsFor<N>>
): void {
  const surface = useSurface();
  if (surface.nested) return;
  const directory = directoryOf(surface);
  createEffect(() => {
    const dispose = directory.provide<N>(surface.id(), methods);
    onCleanup(dispose);
  });
}
