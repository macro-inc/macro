import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import type { UsageSummary } from '../core/usage';
import { UsageTips } from './usage-tips';

const baseSummary: UsageSummary = {
  monthlyPercent: 75,
  periodEnd: '2026-11-01T00:00:00Z',
  unlimited: false,
  creditBalanceCents: 1000,
  creditScope: 'personal',
  billingAccess: 'payer',
  autoReload: {
    settings: {
      enabled: false,
      minimumBalanceCents: 1000,
      targetBalanceCents: 10000,
      monthlySpendLimitCents: null,
    },
    suspended: false,
  },
};

describe('UsageTips', () => {
  it('shows tips when usage is 50% or more', () => {
    render(() => <UsageTips summary={baseSummary} />);
    expect(screen.getByText('Tips to optimize usage')).toBeTruthy();
    expect(screen.getByText('Choose efficient models')).toBeTruthy();
    expect(screen.getByText('Keep context focused')).toBeTruthy();
    expect(screen.getByText('Leverage caching')).toBeTruthy();
  });

  it('shows tips at exactly 50%', () => {
    const at50: UsageSummary = { ...baseSummary, monthlyPercent: 50 };
    render(() => <UsageTips summary={at50} />);
    expect(screen.getByText('Tips to optimize usage')).toBeTruthy();
  });

  it('hides tips when usage is below 50%', () => {
    const low: UsageSummary = { ...baseSummary, monthlyPercent: 25 };
    render(() => <UsageTips summary={low} />);
    expect(screen.queryByText('Tips to optimize usage')).toBeNull();
  });

  it('hides tips for unlimited users', () => {
    const unlimited: UsageSummary = {
      ...baseSummary,
      monthlyPercent: 75,
      unlimited: true,
    };
    render(() => <UsageTips summary={unlimited} />);
    expect(screen.queryByText('Tips to optimize usage')).toBeNull();
  });

  it('handles undefined summary gracefully', () => {
    render(() => <UsageTips summary={undefined} />);
    expect(screen.queryByText('Tips to optimize usage')).toBeNull();
  });

  it('shows model efficiency tip with Gemini Flash recommendation', () => {
    render(() => <UsageTips summary={baseSummary} />);
    expect(
      screen.getByText(/Gemini Flash 3.8 and Kimi offer strong performance/)
    ).toBeTruthy();
  });

  it('shows context tip about shorter conversations', () => {
    render(() => <UsageTips summary={baseSummary} />);
    expect(screen.getByText(/Shorter conversations cost less/)).toBeTruthy();
  });

  it('shows caching tip', () => {
    render(() => <UsageTips summary={baseSummary} />);
    expect(
      screen.getByText(/Macro caches repeated content automatically/)
    ).toBeTruthy();
  });
});
