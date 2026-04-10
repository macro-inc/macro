export function soupViewCacheKey(contentId: string, suffix?: string): string {
  const base = `macro:soup-view:${contentId}`;
  return suffix ? `${base}:${suffix}` : base;
}
