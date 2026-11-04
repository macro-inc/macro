import { describe, expect, it } from 'vitest';
import { orderOnboardingTools } from './tools';

const tools = (slugs: string[]) => slugs.map((slug) => ({ slug }));

describe('onboarding tool ordering', () => {
  it('puts the three pinned apps, startup apps, and business apps before infrastructure', () => {
    expect(
      orderOnboardingTools(
        tools([
          'supabase',
          'mysql',
          'quickbooks',
          'stripe',
          'notion',
          'slack_v2',
          'posthog',
          'linear',
          'github',
          'shopify',
          'unknown_app',
        ])
      ).map((tool) => tool.slug)
    ).toEqual([
      'linear',
      'notion',
      'slack_v2',
      'posthog',
      'stripe',
      'github',
      'quickbooks',
      'shopify',
      'supabase',
      'mysql',
      'unknown_app',
    ]);
  });

  it('deduplicates promoted apps, later pages and Slack aliases, and hides only excluded Google apps', () => {
    expect(
      orderOnboardingTools(
        tools([
          'slack',
          'linear',
          'stripe',
          'gmail',
          'google_sheets',
          'google_drive',
          'google_calendar',
          'slack_v2',
          'linear',
          'stripe',
          'mysql',
          'mysql',
        ])
      ).map((tool) => tool.slug)
    ).toEqual([
      'linear',
      'slack',
      'stripe',
      'google_sheets',
      'google_drive',
      'mysql',
    ]);
  });
});
