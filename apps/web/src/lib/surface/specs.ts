// apps/web/src/lib/surface/specs.ts
//
// Type-level catalog of every surface: mount params and public methods.
// TYPE-ONLY imports from feature directories are allowed (they erase at
// compile time). Value imports from features are forbidden here.

/** A surface method in its natural, possibly-synchronous form. */
export type SurfaceMethod = (...args: never[]) => unknown;

/** A named map of surface methods in natural form. */
export type SurfaceMethodMap = Record<string, SurfaceMethod>;

/**
 * Methods every surface handle exposes without the surface declaring them.
 * Declared in natural form; the handle side async-wraps (see AsHandleMethods).
 * A surface that never provides them yields the bounded-await/no-op behavior
 * described in §3.4.
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

/**
 * Alias names routable to a base surface (URL-visible, dedupe-transparent).
 * Must stay in sync with `aliases` declared in catalog.ts — directory.test.ts
 * asserts the sync (§7). DRAFT: empty; migration adds
 * 'task' | 'snippet' | 'skill' | 'csv' | 'write'.
 */
export type SurfaceAliasName = never;

/** The alias used in the URL together with the catalog surface it resolves to. */
export type SurfaceAliasContext = {
  /** The alias used in the URL / SplitContent.type (e.g. 'task'). */
  alias: SurfaceAliasName;
  /** The catalog surface it resolves to (e.g. 'md'). */
  baseName: SurfaceName;
};

/** Mount params for the named surface. */
export type ParamsFor<N extends SurfaceName> = SurfaceSpecs[N]['params'];

/** Public methods for the named surface, including shared methods. */
export type MethodsFor<N extends SurfaceName> = SharedSurfaceMethods &
  SurfaceSpecs[N]['methods'];

/**
 * Handle-side view of a method map. Exactly the orchestrator BlockHandle
 * mapped type, with one honesty fix: the promise can resolve `undefined`
 * when the surface never provides the method within the timeout (§3.4) —
 * the legacy type claimed `Promise<Awaited<ReturnType<...>>>` but resolved
 * undefined in that case anyway.
 */
export type AsHandleMethods<M extends SurfaceMethodMap> = {
  [K in keyof M]: (
    ...args: Parameters<M[K]>
  ) => Promise<Awaited<ReturnType<M[K]>> | undefined>;
};

/**
 * Provider-side view: a feature may register a subset, and may implement an
 * async-declared method synchronously or vice versa (successor of the
 * orchestrator's MakeOptionalAsyncMethod).
 */
export type AsProvidedMethods<M extends SurfaceMethodMap> = {
  [K in keyof M]?: (
    ...args: Parameters<M[K]>
  ) => ReturnType<M[K]> | Promise<Awaited<ReturnType<M[K]>>>;
};
