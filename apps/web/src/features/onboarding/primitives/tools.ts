import { canonicalPipedreamSlug } from '@core/pipedream/slugs';
import {
  ONBOARDING_HIDDEN_TOOLS,
  ONBOARDING_PRIORITY_TOOLS,
} from '../core/tools';

const priority = new Map<string, number>(
  ONBOARDING_PRIORITY_TOOLS.map(([slug], index) => [slug, index])
);

/** Keep the rest in directory order, with one card per provider on every page. */
export function orderOnboardingTools<T extends { slug: string }>(
  tools: readonly T[]
): T[] {
  const seen = new Set<string>();
  return tools
    .filter((tool) => {
      const slug = canonicalPipedreamSlug(tool.slug);
      if (ONBOARDING_HIDDEN_TOOLS.has(slug) || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    })
    .sort(
      (a, b) =>
        (priority.get(canonicalPipedreamSlug(a.slug)) ??
          Number.MAX_SAFE_INTEGER) -
        (priority.get(canonicalPipedreamSlug(b.slug)) ??
          Number.MAX_SAFE_INTEGER)
    );
}
