export function soupViewCacheKey(contentId: string, suffix?: string): string {
  const base = `macro:soup-view:${contentId}`;
  return suffix ? `${base}:${suffix}` : base;
}

// Tracks how many SoupViewList instances are mounted per contentId.
// Used to detect duplicate splits showing the same view.
export const activeSoupViewCounts = new Map<string, number>();
