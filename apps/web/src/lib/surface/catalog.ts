import { type Component, lazy } from 'solid-js';
import type { SurfaceName } from './specs';

/** Whether the surface names a server-side entity or an app instance. */
export type SurfaceKind = 'entity' | 'app';

/** Static definition of a mountable surface. */
export type SurfaceDefinition = {
  /**
   * The mount component. Takes NO props; features read identity/params via
   * useSurface()/useSurfaceParams(). Always a lazy component here.
   */
  component: Component;
  /**
   * 'entity': id names a server-side entity; dedupes on (name, id).
   * 'app': id is an instance discriminator; never dedupes unless `singleton`.
   */
  kind: SurfaceKind;
  /** At most one live instance per layout; dedupe ignores id. */
  singleton?: boolean;
  /**
   * file-extension → mime-type. Entity surfaces only. Declared source of
   * truth for upload routing / pickers / icons; the derived indexes
   * (successors of the blockAccepted* maps) arrive with that migration.
   */
  accepted?: Readonly<Record<string, string>>;
};

/** Pure static data. Explicit entries, no import.meta.glob, no load(). */
export const surfaceCatalog: Readonly<Record<SurfaceName, SurfaceDefinition>> =
  {
    image: {
      component: lazy(
        () => import('@app/features/block-image/component/Block')
      ),
      kind: 'entity',
      accepted: {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
      },
    },
    inbox: {
      // TODO(migration): real SoupView factory
      component: () => null,
      kind: 'app',
      singleton: false,
    },
  };

/** Identity predicate for layout dedupe. Replaces sameNonComponentIdentity. */
export function sameSurfaceIdentity(
  a: { name: SurfaceName; id: string },
  b: { name: SurfaceName; id: string }
): boolean {
  if (a.name !== b.name) return false;
  const def = surfaceCatalog[a.name];
  if (def.singleton) return true; // one instance per layout, id ignored
  if (def.kind === 'app') return false; // app surfaces never dedupe
  return a.id === b.id; // entity surfaces dedupe on id
}
