import { extractTypeSource } from './source';
import { type ComponentDoc, DOC_CATEGORIES, type DocCategory } from './types';

/**
 * Every `.docs.tsx` file under `components/ui`, discovered at build time.
 * Adding a page is adding a file — there is no list to keep up to date.
 *
 * Modules load eagerly because the sidebar needs each doc's name and category
 * up front; the whole gallery is behind a lazy route, so this all lands in one
 * chunk that the app never loads unless you open it. Sources stay lazy since
 * raw file text is pure page data.
 *
 * Note: `import.meta.glob` cannot resolve TS path aliases, so these patterns
 * are relative (same constraint as IconGallery).
 */
const docModules = import.meta.glob<{ default: ComponentDoc }>(
  '../../components/ui/**/*.docs.tsx',
  { eager: true }
);

const docSources = import.meta.glob<string>(
  '../../components/ui/**/*.docs.tsx',
  { query: '?raw', import: 'default' }
);

/** Component files backing the `@ui` barrel, used by the coverage report. */
const uiComponentModules = import.meta.glob(
  '../../components/ui/components/*.tsx'
);

/**
 * Raw text of the component files, so a page can read its guidance and prop
 * types straight from the implementation instead of restating them. Lazy: only
 * the page you open pays for it.
 */
const componentSources = import.meta.glob<string>(
  '../../components/ui/components/*.tsx',
  { query: '?raw', import: 'default' }
);

export type DocEntry = {
  /** URL-safe id, derived from the filename. */
  slug: string;
  doc: ComponentDoc;
  /** Path shown on the page so the file is easy to jump to. */
  path: string;
  loadSource: () => Promise<string>;
  /**
   * Raw text of the component this page sits beside, or null for a page with
   * no implementation (the Foundations pages). Carries the `@do` / `@dont`
   * guidance and the prop types.
   */
  loadComponentSource: (() => Promise<string>) | null;
};

/** `.../components/Button.docs.tsx` -> `button` */
function slugFromPath(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file
    .replace(/\.docs\.tsx$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/** `../../components/ui/components/Button.docs.tsx` -> `src/components/ui/...` */
function displayPath(path: string): string {
  return path.replace(/^(\.\.\/)+/, 'src/');
}

function buildEntries(): DocEntry[] {
  const bySlug = new Map<string, DocEntry>();

  for (const [path, module] of Object.entries(docModules)) {
    const doc = module.default;
    if (!doc) {
      console.warn(`[ui-gallery] ${path} has no default export; skipping.`);
      continue;
    }

    const slug = slugFromPath(path);
    const existing = bySlug.get(slug);
    if (existing) {
      console.warn(
        `[ui-gallery] ${path} and ${existing.path} both map to slug "${slug}"; keeping the first.`
      );
      continue;
    }

    const loadSource = docSources[path];
    bySlug.set(slug, {
      slug,
      doc,
      path: displayPath(path),
      loadSource: loadSource ?? (() => Promise.resolve('')),
      // `Button.docs.tsx` sits beside `Button.tsx`; deriving the sibling means
      // a page never has to declare where its implementation lives.
      loadComponentSource:
        componentSources[path.replace(/\.docs\.tsx$/, '.tsx')] ?? null,
    });
  }

  return [...bySlug.values()].sort((a, b) =>
    a.doc.name.localeCompare(b.doc.name)
  );
}

export const DOC_ENTRIES: DocEntry[] = buildEntries();

export function findEntry(slug: string): DocEntry | undefined {
  return DOC_ENTRIES.find((entry) => entry.slug === slug);
}

export type DocGroup = { category: DocCategory; entries: DocEntry[] };

/** Entries grouped for the sidebar, in `DOC_CATEGORIES` order. */
export function groupEntries(entries: readonly DocEntry[]): DocGroup[] {
  return DOC_CATEGORIES.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.doc.category === category),
  })).filter((group) => group.entries.length > 0);
}

/** Case-insensitive match over each entry's name, category, and exports. */
export function filterEntries(
  entries: readonly DocEntry[],
  query: string
): DocEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => {
    const haystack = [
      entry.doc.name,
      entry.doc.category,
      entry.doc.description,
      ...(entry.doc.exports ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export type CoverageRow = {
  /** Component file basename, e.g. `Button`. */
  name: string;
  entry?: DocEntry;
};

/**
 * Every component file in `ui/components` paired with the page documenting it,
 * so the undocumented surface stays visible instead of assumed. A page claims a
 * file by matching its name or by listing it in `exports`.
 */
export function coverageRows(): CoverageRow[] {
  const names = Object.keys(uiComponentModules)
    .map((path) => (path.split('/').pop() ?? '').replace(/\.tsx$/, ''))
    .filter(
      (name) => name && !name.endsWith('.test') && !name.endsWith('.docs')
    )
    .sort((a, b) => a.localeCompare(b));

  return names.map((name) => ({
    name,
    entry: DOC_ENTRIES.find(
      (entry) => entry.doc.name === name || entry.doc.exports?.includes(name)
    ),
  }));
}

/**
 * Finds a type declaration anywhere in the `@ui` component sources. Not limited
 * to the page's own sibling, so a page can surface a type it re-exports (Panel
 * documents `SurfaceProps`, which lives in `Surface.tsx`).
 */
export async function loadTypeSource(name: string): Promise<string | null> {
  for (const [path, load] of Object.entries(componentSources)) {
    if (/\.(docs|test)\.tsx$/.test(path)) continue;
    const found = extractTypeSource(await load(), name);
    if (found) return found;
  }
  return null;
}
