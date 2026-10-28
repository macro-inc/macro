import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPARISON_TOOLS,
  summarizeComparison,
} from './pricing-comparison';

describe('pricing comparison', () => {
  it('compares the default business stack with Macro Pro', () => {
    // Superhuman $33 + Notion $20 + Jira $15.56 + Slack $15 + Granola $14 + HubSpot $90.
    expect(summarizeComparison(DEFAULT_COMPARISON_TOOLS, 5)).toEqual({
      monthlySeatCents: 18756,
      toolsCents: 1125360,
      macroCents: 240000,
      differenceCents: 885360,
    });
  });

  it('counts only selected subscriptions and scales the difference by people', () => {
    expect(summarizeComparison(['notion', 'calendly', 'otter'], 3)).toEqual({
      monthlySeatCents: 4999,
      toolsCents: 179964,
      macroCents: 144000,
      differenceCents: 35964,
    });
  });

  it('reports additional cost when Macro costs more instead of claiming savings', () => {
    expect(summarizeComparison(['notion'], 1).differenceCents).toBe(-24000);
    expect(summarizeComparison([], 5).differenceCents).toBe(-240000);
    expect(summarizeComparison(['notion', 'airtable'], 1).differenceCents).toBe(
      0
    );
  });
});
