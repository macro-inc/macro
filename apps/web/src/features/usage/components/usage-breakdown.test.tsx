import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import type { UsageSummary } from '../core/usage';
import { UsageBreakdown } from './usage-breakdown';

const baseSummary: UsageSummary = {
  monthlyPercent: 50,
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

describe('UsageBreakdown', () => {
  it('renders usage categories', () => {
    render(() => <UsageBreakdown summary={baseSummary} />);
    expect(screen.getByText('AI Agent Chats')).toBeTruthy();
    expect(screen.getByText('Document Editing')).toBeTruthy();
    expect(screen.getByText('AI Memory')).toBeTruthy();
    expect(screen.getByText('Other AI Features')).toBeTruthy();
  });

  it('shows what counts toward usage explanation', () => {
    render(() => <UsageBreakdown summary={baseSummary} />);
    expect(screen.getByText('What counts toward usage')).toBeTruthy();
    expect(
      screen.getByText(/Your monthly usage is measured in API cost/)
    ).toBeTruthy();
  });

  it('shows period breakdown for non-unlimited users', () => {
    render(() => <UsageBreakdown summary={baseSummary} />);
    expect(screen.getByText('This period')).toBeTruthy();
    expect(screen.getByText('50% of allowance used')).toBeTruthy();
    expect(screen.getByText('+ $10 credits')).toBeTruthy();
  });

  it('hides period breakdown for unlimited users', () => {
    const unlimited: UsageSummary = { ...baseSummary, unlimited: true };
    render(() => <UsageBreakdown summary={unlimited} />);
    expect(screen.queryByText('This period')).toBeNull();
  });

  it('shows remaining percentage when no credits', () => {
    const noCredits: UsageSummary = { ...baseSummary, creditBalanceCents: 0 };
    render(() => <UsageBreakdown summary={noCredits} />);
    expect(screen.getByText('50% remaining')).toBeTruthy();
  });

  it('handles undefined summary gracefully', () => {
    render(() => <UsageBreakdown summary={undefined} />);
    expect(screen.getByText('What counts toward usage')).toBeTruthy();
    expect(screen.queryByText('This period')).toBeNull();
  });

  it('shows at-limit state correctly', () => {
    const atLimit: UsageSummary = {
      ...baseSummary,
      monthlyPercent: 100,
      creditBalanceCents: 0,
    };
    render(() => <UsageBreakdown summary={atLimit} />);
    expect(screen.getByText('100% of allowance used')).toBeTruthy();
    expect(screen.getByText('0% remaining')).toBeTruthy();
  });
});
