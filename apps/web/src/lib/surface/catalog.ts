import { ENABLE_DOCX_TO_PDF } from '@core/constant/featureFlags';
import { DefaultFilename } from '@core/constant/filename';
import { type Component, lazy } from 'solid-js';
import type {
  SurfaceAliasContext,
  SurfaceAliasName,
  SurfaceName,
} from './specs';

/** Whether the surface names a server-side entity or an app instance. */
export type SurfaceKind = 'entity' | 'app';

/** An alias name routable to a catalog surface, with optional default filename. */
export type SurfaceAliasDef = {
  name: SurfaceAliasName;
  /** Default filename for new entities created under this alias
   *  (e.g. task → 'To-do'). Ports BlockDefinition.aliases[].defaultFileName. */
  defaultFilename?: string;
};

/** Static definition of a mountable surface. */
export type SurfaceDefinition = {
  /**
   * The mount component. Takes NO props; features read identity/params via
   * useSurface()/useSurfaceParams(). Always a lazy component here:
   * component: lazy(() => import('@app/features/block-image/component/Block')).
   */
  component: Component;
  /**
   * 'entity': id names a server-side entity. Dedupes on (resolved name, id),
   *   round-trips through the URL, eligible for EntityFrame/open-tracking.
   * 'app': id is an instance discriminator chosen by the app (usually the
   *   surface name itself, e.g. 'settings'; or a draft id for composers).
   *   Never dedupes unless `singleton`.
   */
  kind: SurfaceKind;
  /** At most one live instance per layout; dedupe ignores id (§2.3). */
  singleton?: boolean;
  aliases?: readonly SurfaceAliasDef[];
  /**
   * file-extension → mime-type. Entity surfaces only. Drives upload routing,
   * file pickers, and icon resolution (§2.5). Same shape as
   * BlockDefinition.accepted today.
   */
  accepted?: Readonly<Record<string, string>>;
  /**
   * Surfaces inside which this surface may mount as a nested preview.
   * Ports ValidNestingCombinations (only non-empty rows: canvas/pdf/code → ['md']).
   */
  nestableIn?: readonly SurfaceName[];
  /** Default display name for unnamed entities of this surface. */
  defaultFilename?: string;
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

const aliasToOwner = new Map<string, SurfaceName>();
const aliasDefaultFilename = new Map<string, string>();

for (const name of Object.keys(surfaceCatalog) as SurfaceName[]) {
  for (const alias of surfaceCatalog[name].aliases ?? []) {
    aliasToOwner.set(alias.name, name);
    if (alias.defaultFilename !== undefined) {
      aliasDefaultFilename.set(alias.name, alias.defaultFilename);
    }
  }
}

/**
 * True when `name` is a declared surface alias.
 */
export function isSurfaceAlias(name: string): name is SurfaceAliasName {
  return aliasToOwner.has(name);
}

/**
 * Alias → base name; identity for non-aliases. Handles the flag-conditional
 * 'write' → 'pdf' virtual name exactly as fileTypeToBlockName does today
 * (gated on ENABLE_DOCX_TO_PDF).
 */
export function resolveSurfaceAlias(
  name: SurfaceName | SurfaceAliasName
): SurfaceName {
  // Flag-conditional virtual name: 'write' → 'pdf' when ENABLE_DOCX_TO_PDF.
  // Unreachable until `write` is typed as a SurfaceAliasName of `pdf`.
  if (ENABLE_DOCX_TO_PDF && (name as string) === 'write') {
    return 'pdf' as SurfaceName;
  }
  return aliasToOwner.get(name) ?? (name as SurfaceName);
}

/**
 * The alias round-trip record for a content type, or undefined when `name`
 * is not an alias. Replaces layoutManager's attachAliasContext computation.
 */
export function surfaceAliasContextFor(
  name: string
): SurfaceAliasContext | undefined {
  if (!isSurfaceAlias(name)) return undefined;
  return {
    alias: name,
    baseName: resolveSurfaceAlias(name),
  };
}

/**
 * 'junk' → undefined in the draft; migration changes the fallback to
 * 'unknown' once the unknown surface is registered (parity with
 * verifyBlockName).
 */
export function verifySurfaceName(
  name: string | undefined
): SurfaceName | SurfaceAliasName | undefined {
  if (!name) return undefined;
  if (ENABLE_DOCX_TO_PDF && name === 'write') {
    return resolveSurfaceAlias(name as SurfaceAliasName);
  }
  if (isSurfaceAlias(name)) return name;
  if (Object.hasOwn(surfaceCatalog, name)) return name as SurfaceName;
  return undefined;
}

/**
 * Identity predicate for layout dedupe. Replaces sameNonComponentIdentity.
 */
export function sameSurfaceIdentity(
  a: { name: SurfaceName | SurfaceAliasName; id: string },
  b: { name: SurfaceName | SurfaceAliasName; id: string }
): boolean {
  const an = resolveSurfaceAlias(a.name);
  const bn = resolveSurfaceAlias(b.name);
  if (an !== bn) return false; // includes alias flattening: md vs task/<same id> collide
  const def = surfaceCatalog[an];
  if (def?.singleton) return true; // one instance per layout, id ignored
  if (def?.kind === 'app') return false; // app surfaces never dedupe (today: components exempt)
  return a.id === b.id; // entity surfaces dedupe on id
}

const extensionToMime: Record<string, string> = {};
const mimeToExtension: Record<string, string> = {};
const nameToExtensions = {} as Record<SurfaceName, string[]>;
const extensionToSurface: Record<string, SurfaceName> = {};

for (const name of Object.keys(surfaceCatalog) as SurfaceName[]) {
  const accepted = surfaceCatalog[name].accepted;
  const extensions: string[] = [];
  if (accepted) {
    for (const [ext, mime] of Object.entries(accepted)) {
      extensions.push(ext);
      extensionToMime[ext] ??= mime;
      mimeToExtension[mime] ??= ext;
      extensionToSurface[ext] ??= name;
    }
  }
  nameToExtensions[name] = extensions;
}

/** Extension → mime, first-wins on collision. Successor of blockAcceptedFileExtensionToMimeType. */
export const surfaceAcceptedExtensionToMime: Readonly<Record<string, string>> =
  extensionToMime;

/** Mime → extension, first-wins on collision. Successor of blockAcceptedMimetypeToFileExtension. */
export const surfaceAcceptedMimeToExtension: Readonly<Record<string, string>> =
  mimeToExtension;

/** Per-surface accepted file extensions. Successor of blockNameToFileExtensions. */
export const surfaceNameToFileExtensions: Readonly<
  Record<SurfaceName, readonly string[]>
> = nameToExtensions;

/**
 * Reverse lookup of a file extension to the surface that accepts it.
 * Successor of the fileTypeToBlockName_ reverse map.
 */
export function surfaceForFileExtension(ext: string): SurfaceName | undefined {
  return extensionToSurface[ext];
}

/**
 * Whether the named surface accepts the given file extension.
 */
export function surfaceAcceptsFileExtension(
  name: SurfaceName,
  ext: string
): boolean {
  return surfaceNameToFileExtensions[name]?.includes(ext) ?? false;
}

/**
 * Default display name for unnamed entities of this surface (or alias).
 * Falls back to DefaultFilename from @core/constant/filename.
 */
export function surfaceDefaultFilename(
  name: SurfaceName | SurfaceAliasName | undefined
): string {
  if (!name) return DefaultFilename;
  const aliasFilename = aliasDefaultFilename.get(name);
  if (aliasFilename !== undefined) return aliasFilename;
  const resolved = resolveSurfaceAlias(name);
  return surfaceCatalog[resolved]?.defaultFilename ?? DefaultFilename;
}
