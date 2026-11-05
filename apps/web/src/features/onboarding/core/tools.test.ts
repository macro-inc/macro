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
    expect(ranked({ 'stripe.com': 2, 'linear.app': 1 })).toEqual([
      ['stripe', 2],
      ['linear', 1],
      ['slack', 0],
      ['notion', 0],
    ]);
    expect(ranked({})).toEqual([
      ['slack', 0],
      ['linear', 0],
      ['notion', 0],
      ['github', 0],
    ]);
  });

  it('asks about each sender domain once, within the endpoint limit', () => {
    expect(new Set(ONBOARDING_SENDER_DOMAINS).size).toBe(
      ONBOARDING_SENDER_DOMAINS.length
    );
    expect(ONBOARDING_SENDER_DOMAINS.length).toBeLessThanOrEqual(40);
  });
});
