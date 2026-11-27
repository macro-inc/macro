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
      if (ONBOARDING_HIDDEN_TOOLS.has(tool.slug) || seen.has(tool.slug))
        return false;
      seen.add(tool.slug);
      return true;
    })
    .sort(
      (a, b) =>
        (priority.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(b.slug) ?? Number.MAX_SAFE_INTEGER)
    );
}
