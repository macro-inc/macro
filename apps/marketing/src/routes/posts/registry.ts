/**
 * Posts live in `entries/<folder>/index.tsx` — export `postMeta` + default component.
 * Optional `postMeta.tags` (lowercased); filter at `/posts?tag=name`.
 */
import type { Component } from 'solid-js';

/** Export as `postMeta` (+ default component) from each folder under `entries/`. */
export interface PostMeta {
  slug: string;
  title: string;
  /** Optional second line under the title, rendered smaller on the post page. */
  titleLine2?: string;
  /** Centered subheader shown under the title on the post page. */
  subtitle?: string;
  /** Overrides the `<title>`/og:title (before " · Macro"); use for SEO-tuned titles. */
  seoTitle?: string;
  /** Original publish date (`YYYY-MM-DD`). */
  date?: string;
  /**
   * Last substantive update (`YYYY-MM-DD`). Set when the post changes after
   * publish; omit when unchanged. Feeds `article:modified_time`, JSON-LD
   * `dateModified`, sitemap `<lastmod>`, and a visible "Last updated" line.
   */
  updated?: string;
  /** SEO / meta description (og, sitemap, post page). Keep keyword-tuned. */
  description?: string;
  /**
   * Short card blurb for the blog index and homepage. Falls back to
   * `description` when omitted — use when the SEO description is too formulaic
   * for cards (e.g. comparison posts).
   */
  preview?: string;
  tags?: string[];
  /**
   * Keep the post off the homepage's "From the Macro blog" section. It still
   * appears at `/posts` and has its own page — this only controls whether it
   * is one of the cards we put in front of every visitor to the front page.
   */
  hideFromHome?: boolean;
  /** Display category (e.g. "Comparison"); falls back to the first tag. */
  category?: string;
  /** Brand key for the hero switch graphic (e.g. "linear", "notion"). */
  coverBrand?: string;
  /** Absolute or root-relative social-share image path. */
  image?: string;
  /** Post author shown in the byline. */
  author?: { name: string; role?: string; avatar?: string };
  showTOC?: boolean;
  tocDepth?: 2 | 3;
  /** Analytics `buttonName` for the homepage-style final CTA; defaults to `blog_<slug>_cta`. */
  ctaButtonName?: string;
}

/**
 * Tie the last two words of a title together with a non-breaking space, so the
 * final word can never wrap onto a line of its own ("… Open Source", never a
 * lone "Source"). Titles only wrap on narrow screens, so this is a mobile fix.
 *
 * Visible titles only — never the `<title>`/og:title, which should stay plain.
 */
export function avoidTitleOrphan(title: string): string {
  return title.trimEnd().replace(/\s+(\S+)$/, '\u00A0$1');
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const n = normalizeTag(raw);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// Exclude the site's own name and specific competitor tags from the filter
// bar so the primary categories fit on a single line alongside the search input.
export const EXCLUDED_FILTER_TAGS = new Set([
  'macro',
  'clickup',
  'linear',
  'notion',
  'slack',
  'superhuman',
]);

export function collectAllTags(postList: { meta: PostMeta }[]): string[] {
  const seen = new Set<string>();
  for (const p of postList) {
    for (const t of normalizeTags(p.meta.tags)) {
      if (!EXCLUDED_FILTER_TAGS.has(t)) {
        seen.add(t);
      }
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function postHasTag(meta: PostMeta, tag: string): boolean {
  return normalizeTags(meta.tags).includes(normalizeTag(tag));
}

export function formatTagLabel(tag: string): string {
  const t = normalizeTag(tag);
  if (!t) return tag;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface PostEntry {
  meta: PostMeta;
  component: Component;
}

type PostModule = {
  default: Component;
  postMeta: PostMeta;
};

const modules = import.meta.glob<PostModule>('./entries/*/index.tsx', {
  eager: true,
});

function buildRegistry(): PostEntry[] {
  const entries: PostEntry[] = [];
  const seenSlugs = new Map<string, string>();

  for (const path of Object.keys(modules)) {
    const mod = modules[path];
    if (!mod?.postMeta || !mod?.default) {
      console.warn(
        `[posts] Skipping "${path}": export postMeta and a default component.`
      );
      continue;
    }

    const { slug, title } = mod.postMeta;
    if (!slug?.trim() || !title?.trim()) {
      console.warn(
        `[posts] Skipping "${path}": postMeta.slug and postMeta.title are required.`
      );
      continue;
    }

    const prev = seenSlugs.get(slug);
    if (prev) {
      console.error(
        `[posts] Duplicate slug "${slug}" in "${path}" and "${prev}".`
      );
      continue;
    }
    seenSlugs.set(slug, path);

    const meta: PostMeta = {
      ...mod.postMeta,
      tags: normalizeTags(mod.postMeta.tags),
    };

    entries.push({ meta, component: mod.default });
  }

  return entries.sort((a, b) => {
    const da = a.meta.date ?? '';
    const db = b.meta.date ?? '';
    if (da && db && da !== db) return db.localeCompare(da);
    return a.meta.title.localeCompare(b.meta.title);
  });
}

export const posts: PostEntry[] = buildRegistry();

export function getPostBySlug(slug: string): PostEntry | undefined {
  return posts.find((p) => p.meta.slug === slug);
}
