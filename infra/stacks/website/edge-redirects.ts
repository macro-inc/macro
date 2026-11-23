/** Retired tool URLs share an edge rule instead of hundreds of map entries. */
export function compactEdgeRedirects(redirects: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(redirects).filter(([source, destination]) => {
      const isTool = /^\/(?:docs\/)?AI\/mcp\/tools\/[^/]+$/.test(source);
      const target = source.endsWith('.md')
        ? '/docs/AI/mcp/overview.md'
        : '/docs/AI/mcp/overview';
      return !isTool || destination !== target;
    })
  );
}
