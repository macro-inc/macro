import { describe, expect, it } from 'vitest';
import { ONBOARDING_SENDER_DOMAINS, rankSuggestedTools } from './tools';

const ranked = (counts: Record<string, number>) =>
  rankSuggestedTools(counts).map((suggestion) => [
    suggestion.tool.slug,
    suggestion.messageCount,
  ]);

describe('rankSuggestedTools', () => {
  it('ranks the tools that email the viewer most, summing their domains', () => {
    expect(
      ranked({
        'github.com': 214,
        'linear.app': 86,
        'stripe.com': 31,
        'notion.so': 9,
        'makenotion.com': 3,
        'figma.com': 4,
      })
    ).toEqual([
      ['github', 214],
      ['linear', 86],
      ['stripe', 31],
      ['notion', 12],
    ]);
  });

  it('tops up with defaults when the inbox shows too little', () => {
    // Under three messages is noise, not a detected tool.
    expect(ranked({ 'stripe.com': 4, 'linear.app': 2 })).toEqual([
      ['stripe', 4],
      ['slack', 0],
      ['linear', 0],
      ['notion', 0],
    ]);
    expect(ranked({})).toEqual([
      ['slack', 0],
      ['linear', 0],
      ['notion', 0],
      ['github', 0],
    ]);
  });

  it('suggests one tool per category, the most-mailed', () => {
    expect(
      ranked({
        'linear.app': 40,
        'asana.com': 90,
        'atlassian.net': 12,
        'slack.com': 20,
      })
    ).toEqual([
      ['asana', 90],
      ['slack', 20],
      ['notion', 0],
      ['github', 0],
    ]);
  });

  it('always makes room for a detected CRM and store', () => {
    expect(
      ranked({
        'github.com': 500,
        'linear.app': 300,
        'slack.com': 200,
        'figma.com': 100,
        'pipedrive.com': 6,
        'hubspot.com': 4,
        'shopify.com': 3,
      })
    ).toEqual([
      ['pipedrive', 6],
      ['shopify', 3],
      ['github', 500],
      ['linear', 300],
    ]);
  });

  it('asks about each sender domain once, within the endpoint limit', () => {
    expect(new Set(ONBOARDING_SENDER_DOMAINS).size).toBe(
      ONBOARDING_SENDER_DOMAINS.length
    );
    expect(ONBOARDING_SENDER_DOMAINS.length).toBeLessThanOrEqual(40);
  });
});
