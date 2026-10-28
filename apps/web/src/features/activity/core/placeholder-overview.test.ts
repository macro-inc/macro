import { describe, expect, it } from 'vitest';
import { buildContributionGrid } from './contribution-grid';
import { placeholderOverview } from './placeholder-overview';

describe('placeholderOverview', () => {
  it('spans the 365 local dates ending after today', () => {
    const overview = placeholderOverview(new Date(2026, 8, 6, 15, 30));
    expect(overview.to).toBe('2026-09-07');
    expect(overview.from).toBe('2025-09-07');
    expect(overview.days).toEqual([]);
    expect(overview.total).toBe(0);
  });

  it('lays out the same week columns as a real overview of that window', () => {
    const now = new Date(2026, 8, 6);
    const placeholder = placeholderOverview(now);
    const real = {
      ...placeholder,
      days: [{ date: '2026-09-01', count: 3 }],
      total: 3,
    };
    expect(buildContributionGrid(placeholder).weeks).toHaveLength(
      buildContributionGrid(real).weeks.length
    );
  });
});
