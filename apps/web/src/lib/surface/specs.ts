// apps/web/src/lib/surface/specs.ts
//
// Type-level catalog of every surface: mount params and public methods.
// TYPE-ONLY imports from feature directories are allowed (they erase at
// compile time). Value imports from features are forbidden here.

/** A surface method in its natural, possibly-synchronous form. */
export type SurfaceMethod = (...args: never[]) => unknown;

/**
 * A named map of surface methods in natural form.
 *
 * Convention: a method that a feature may implement either synchronously or
 * asynchronously must be declared with a `T | Promise<T>` return (see
 * SharedSurfaceMethods). Providers then pass plain implementations checked
 * against Partial<MethodsFor<N>> — no provider-side mapped type exists.
 */
export type SurfaceMethodMap = Record<string, SurfaceMethod>;

/**
 * Methods every surface handle exposes without the surface declaring them.
 * Declared in natural form; the handle side async-wraps (see AsHandleMethods).
 * A surface that never provides them yields the bounded-await/no-op behavior
 * documented on SurfaceDirectory.handle.
 */
export type SharedSurfaceMethods = {
  /** Re-aim an already-mounted surface at a location described by params. */
  goToLocationFromParams: (
    params: Record<string, string>
  ) => void | Promise<void>;
  /** Land the surface on its latest content (e.g. newest channel messages). */
  goToLatest: () => void | Promise<void>;
};

/** Shape every SurfaceSpecs entry must conform to. */
export type SurfaceSpec = {
  /** One-shot mount params delivered through SplitContent.params. */
  params: Record<string, unknown>;
  /** Surface-specific public methods, in natural (possibly sync) form. */
  methods: SurfaceMethodMap;
};

/**
 * Empty method map for a surface that declares no surface-specific methods.
 * Must be `Record<never, SurfaceMethod>`, not `Record<string, never>`:
 * intersecting SharedSurfaceMethods with a `string` index of `never` collapses
 * every method (including goToLatest / goToLocationFromParams) to `never`.
 * `Record<never, SurfaceMethod>` still conforms to SurfaceMethodMap.
 */
export type EmptySurfaceMethods = Record<never, SurfaceMethod>;

/** Empty params map for a surface that declares no mount params. */
export type EmptySurfaceParams = Record<string, never>;

/**
 * The catalog. Migration PRs add one entry per migrated surface, importing
 * param/method types type-only from the owning feature, e.g.:
 *
 *   import type { CalendarBlockProps } from '@block-calendar/types';
 *   calendar: { params: CalendarBlockProps; methods: {} };
 *   chat: { params: {}; methods: BlockChatSpec };            // @block-chat/blockClient
 *   md: { params: BlockMarkdownProps; methods: MarkdownBlockSpec };
 *
 * DRAFT: one real entity surface ('image') + one app surface stub ('inbox').
 */
export interface SurfaceSpecs {
  image: {
    params: EmptySurfaceParams;
    methods: EmptySurfaceMethods;
  };
  inbox: {
    params: EmptySurfaceParams;
    methods: EmptySurfaceMethods;
  };
}

// Compile-time conformance check: fails to typecheck when any SurfaceSpecs
// entry deviates from SurfaceSpec (unlike the old AssertSpec pattern in
// blockMethodRegistry.ts, which silently degraded to an empty spec).
declare const _surfaceSpecsConform: SurfaceSpecs extends Record<
  keyof SurfaceSpecs,
  SurfaceSpec
>
  ? true
  : never;

/** Catalog keys; every registered surface name. */
export type SurfaceName = keyof SurfaceSpecs & string;

/** Mount params for the named surface. */
export type ParamsFor<N extends SurfaceName> = SurfaceSpecs[N]['params'];

/** Public methods for the named surface, including shared methods. */
export type MethodsFor<N extends SurfaceName> = SharedSurfaceMethods &
  SurfaceSpecs[N]['methods'];

/**
 * Handle-side view of a method map. Exactly the orchestrator BlockHandle
 * mapped type, with one honesty fix: the promise can resolve `undefined`
 * when the surface never provides the method within the timeout — the
 * bounded-await/no-op behavior documented on SurfaceDirectory.handle.
 * The legacy type claimed `Promise<Awaited<ReturnType<...>>>` but resolved
 * undefined in that case anyway.
 */
export type AsHandleMethods<M extends SurfaceMethodMap> = {
  [K in keyof M]: (
    ...args: Parameters<M[K]>
  ) => Promise<Awaited<ReturnType<M[K]>> | undefined>;
};
