// Match the backend's selection order for existing Slack connections.
export const SLACK_PIPEDREAM_SLUGS = ['slack', 'slack_v2'] as const;
// Pipedream's OAuth Slack connector; `slack` remains a legacy connection alias.
export const SLACK_CONNECT_SLUG = 'slack_v2';

export function isSlackPipedreamSlug(slug: string): boolean {
  return SLACK_PIPEDREAM_SLUGS.some((alias) => alias === slug);
}

export function canonicalPipedreamSlug(slug: string): string {
  return isSlackPipedreamSlug(slug) ? 'slack' : slug;
}

export function pipedreamSlugsMatch(a: string, b: string): boolean {
  return canonicalPipedreamSlug(a) === canonicalPipedreamSlug(b);
}

export function connectSlugForPipedreamApp(slug: string): string {
  return slug === 'slack' ? SLACK_CONNECT_SLUG : slug;
}
