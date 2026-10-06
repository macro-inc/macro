import { describe, expect, it } from 'vitest';
import {
  formatWholeUsd,
  SALES_HEADLINE_TOOLS,
  salesSavings,
  salesTool,
  tierMonthlyCents,
} from './sales-savings';

describe('sales savings', () => {
  it('prices the headline stack on business plans', () => {
    const perSeat = SALES_HEADLINE_TOOLS.reduce(
      (total, id) => total + tierMonthlyCents(salesTool(id), 'business'),
      0
    );
    // Notion $20 + Linear $16 + Superhuman $33 + Slack Business+ $15.
    expect(perSeat).toBe(8400);
  });

  it('compares a five-seat team with Macro', () => {
    expect(salesSavings(SALES_HEADLINE_TOOLS, 5, 'business')).toEqual({
      toolsCents: 504_000,
      macroCents: 240_000,
      savedCents: 264_000,
    });
  });

  it('uses entry plans on the starter tier', () => {
    // Notion $10 + Linear $10 + Superhuman $25 + Slack Pro $7.25.
    expect(salesSavings(SALES_HEADLINE_TOOLS, 1, 'starter').toolsCents).toBe(
      62_700
    );
  });

  it('never reports negative savings', () => {
    const result = salesSavings(['notion'], 3, 'starter');
    expect(result.toolsCents).toBeLessThan(result.macroCents);
    expect(result.savedCents).toBe(0);
  });

  it('formats whole dollars', () => {
    expect(formatWholeUsd(264_000)).toBe('$2,640');
    expect(formatWholeUsd(62_750)).toBe('$628');
  });
});
