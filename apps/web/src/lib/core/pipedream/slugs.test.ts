import { describe, expect, it } from 'vitest';
import {
  canonicalPipedreamSlug,
  connectSlugForPipedreamApp,
  isSlackPipedreamSlug,
  pipedreamSlugsMatch,
  SLACK_CONNECT_SLUG,
  SLACK_PIPEDREAM_SLUGS,
} from './slugs';

describe('Pipedream slugs', () => {
  it('keeps the documented fallback connect slug first', () => {
    expect(SLACK_PIPEDREAM_SLUGS).toEqual(['slack', 'slack_v2']);
    expect(SLACK_CONNECT_SLUG).toBe(SLACK_PIPEDREAM_SLUGS[0]);
  });

  it.each(SLACK_PIPEDREAM_SLUGS)('recognizes %s as Slack', (slug) => {
    expect(isSlackPipedreamSlug(slug)).toBe(true);
    expect(canonicalPipedreamSlug(slug)).toBe('slack');
    for (const alias of SLACK_PIPEDREAM_SLUGS) {
      expect(pipedreamSlugsMatch(slug, alias)).toBe(true);
    }
    expect(pipedreamSlugsMatch(slug, 'github')).toBe(false);
    expect(pipedreamSlugsMatch('github', slug)).toBe(false);
  });

  it.each(['github', 'linear', '', 'Slack', 'slack_v3'])(
    'preserves non-Slack slug %j',
    (slug) => {
      expect(isSlackPipedreamSlug(slug)).toBe(false);
      expect(canonicalPipedreamSlug(slug)).toBe(slug);
      expect(connectSlugForPipedreamApp(slug)).toBe(slug);
      expect(pipedreamSlugsMatch(slug, slug)).toBe(true);
      expect(pipedreamSlugsMatch(slug, 'slack')).toBe(false);
    }
  );

  it('does not match different non-Slack apps', () => {
    expect(pipedreamSlugsMatch('github', 'linear')).toBe(false);
  });

  it('connects the Slack provider using the documented slug', () => {
    expect(connectSlugForPipedreamApp('slack')).toBe(SLACK_CONNECT_SLUG);
    expect(connectSlugForPipedreamApp('slack_v2')).toBe('slack_v2');
  });
});
