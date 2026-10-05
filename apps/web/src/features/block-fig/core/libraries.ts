/**
 * Team libraries: which library assets have newer published versions than
 * this file's copies, how a library's assets list in the Assets panel, and
 * the libraries a file uses.
 */

import type {
  AssetKind,
  LibraryCopy,
  LibraryRef,
  LibraryUse,
  PublishedAsset,
  PublishedLibrary,
} from '@core/fig-engine/library-types';

/** The engine operations of team libraries (`fig_engine::edit::library`). */
export type LibraryOp =
  /** Keys and versions for every asset (keys from `seed`, the document id). */
  | { op: 'publishLibrary'; seed: string; note?: string }
  /** The libraries the file uses, replacing the list. */
  | { op: 'setLibraries'; libraries: LibraryRef[] };

/** A copy whose library published a newer version. */
export interface LibraryUpdate {
  /** The library's document id. */
  library: string;
  libraryName: string;
  key: string;
  name: string;
  kind: AssetKind;
  /** The copy in this file. */
  copyId: string;
  /** The asset in the library file. */
  assetId: string;
  from: string | null;
  to: string;
}

/** Copies that are not top-level assets on their own (variants, whose set updates with them). */
function shownAlone(
  copy: LibraryCopy,
  copies: readonly LibraryCopy[]
): boolean {
  if (copy.kind !== 'COMPONENT' || !copy.setKey) return true;
  return !copies.some((c) => c.key === copy.setKey);
}

/**
 * The copies in `uses` whose library (among `libraries`, by id) publishes a
 * different version, a component set once (not each variant).
 */
export function libraryUpdates(
  uses: LibraryUse,
  libraries: ReadonlyMap<string, PublishedLibrary>
): LibraryUpdate[] {
  const names = new Map(uses.enabled.map((l) => [l.id, l.name]));
  const out: LibraryUpdate[] = [];
  for (const copy of uses.copies) {
    if (!copy.library || !names.has(copy.library)) continue;
    const published = libraries.get(copy.library);
    if (!published) continue;
    const asset = published.assets.find((a) => a.key === copy.key);
    if (!asset || asset.version === copy.version) continue;
    if (!shownAlone(copy, uses.copies)) continue;
    out.push({
      library: copy.library,
      libraryName: names.get(copy.library) ?? 'Library',
      key: copy.key,
      name: copy.name,
      kind: copy.kind,
      copyId: copy.id,
      assetId: asset.id,
      from: copy.version,
      to: asset.version,
    });
  }
  return out;
}

/**
 * Copies whose library is not enabled, or no longer publishes them: they
 * stay as they are, without updates.
 */
export function detachedCopies(
  uses: LibraryUse,
  libraries: ReadonlyMap<string, PublishedLibrary>
): LibraryCopy[] {
  const enabled = new Set(uses.enabled.map((l) => l.id));
  return uses.copies.filter((c) => {
    if (!shownAlone(c, uses.copies) || c.kind === 'COLLECTION') return false;
    if (!c.library || !enabled.has(c.library)) return true;
    const published = libraries.get(c.library);
    return !!published && !published.assets.some((a) => a.key === c.key);
  });
}

/** One group of a library's assets in the Assets panel. */
export interface AssetGroup {
  /** The component set, name folder (`Icon/…`), style type, or collection. */
  title: string;
  kind: 'components' | 'styles' | 'variables';
  assets: PublishedAsset[];
}

/** The folder a slash-separated name sits in (`Icon/Star` → `Icon`). */
function folder(name: string): string {
  const at = name.lastIndexOf('/');
  return at > 0 ? name.slice(0, at) : '';
}

/** The label an asset is searched and shown by. */
export function assetLabel(a: PublishedAsset): string {
  return a.set ? `${a.set} ${a.name}` : a.name;
}

const STYLE_TITLES: Record<string, string> = {
  FILL: 'Color styles',
  TEXT: 'Text styles',
  EFFECT: 'Effect styles',
  GRID: 'Grid styles',
};

/**
 * A library's published assets matching `query`, grouped: components by
 * set (or name folder), styles by what they style, variables by
 * collection. Component sets themselves are not listed; their variants are.
 */
export function groupAssets(
  library: PublishedLibrary,
  query: string
): AssetGroup[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, AssetGroup>();
  const add = (
    id: string,
    group: Omit<AssetGroup, 'assets'>,
    a: PublishedAsset
  ) => {
    let g = groups.get(id);
    if (!g) {
      g = { ...group, assets: [] };
      groups.set(id, g);
    }
    g.assets.push(a);
  };
  for (const a of library.assets) {
    if (q && !assetLabel(a).toLowerCase().includes(q)) continue;
    switch (a.kind) {
      case 'COMPONENT': {
        const title = a.set ?? folder(a.name);
        add(`c:${title}`, { title, kind: 'components' }, a);
        break;
      }
      case 'STYLE': {
        const type = a.style?.type ?? 'FILL';
        add(
          `s:${type}`,
          { title: STYLE_TITLES[type] ?? 'Styles', kind: 'styles' },
          a
        );
        break;
      }
      case 'VARIABLE': {
        const title = a.variable?.collection ?? 'Variables';
        add(`v:${title}`, { title, kind: 'variables' }, a);
        break;
      }
      default:
        break;
    }
  }
  const order = { components: 0, styles: 1, variables: 2 };
  return [...groups.values()].sort(
    (x, y) => order[x.kind] - order[y.kind] || x.title.localeCompare(y.title)
  );
}

/** `enabled` with `library` turned on or off (by id), in their order. */
export function withLibrary(
  enabled: readonly LibraryRef[],
  library: LibraryRef,
  on: boolean
): LibraryRef[] {
  const rest = enabled.filter((l) => l.id !== library.id);
  return on ? [...rest, library] : rest;
}

/** What a style applies to: Figma's `ApplyStyle` kinds. */
export function styleKind(
  asset: PublishedAsset
): 'FILL' | 'TEXT' | 'EFFECT' | null {
  switch (asset.style?.type) {
    case 'FILL':
      return 'FILL';
    case 'TEXT':
      return 'TEXT';
    case 'EFFECT':
      return 'EFFECT';
    default:
      return null;
  }
}

/** A short summary of changes for the update notice ("2 components, 1 style"). */
export function updateSummary(updates: readonly LibraryUpdate[]): string {
  const count = (kinds: AssetKind[]) =>
    updates.filter((u) => kinds.includes(u.kind)).length;
  const parts: string[] = [];
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const components = count(['COMPONENT', 'COMPONENT_SET']);
  const styles = count(['STYLE']);
  const variables = count(['VARIABLE', 'COLLECTION']);
  if (components) parts.push(plural(components, 'component'));
  if (styles) parts.push(plural(styles, 'style'));
  if (variables) parts.push(plural(variables, 'variable'));
  return parts.join(', ');
}

/** The drag data type of a library component dragged from the Assets panel. */
export const LIBRARY_ASSET_MIME = 'application/x-macro-fig-asset';

/** A dragged library component: its library and key. */
export interface DraggedAsset {
  library: string;
  key: string;
}

/** The library component in drag data, if it holds one. */
export function draggedAsset(text: string | undefined): DraggedAsset | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (
      typeof v === 'object' &&
      v !== null &&
      'library' in v &&
      'key' in v &&
      typeof v.library === 'string' &&
      typeof v.key === 'string'
    )
      return { library: v.library, key: v.key };
  } catch {
    // Not ours.
  }
  return null;
}
