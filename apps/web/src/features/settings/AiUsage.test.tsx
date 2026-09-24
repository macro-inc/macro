import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiUsageMeter } from './AiUsage';

vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Button: () => null,
  ToggleSwitch: () => null,
}));

const snapshot = (seats: number): AiUsageSnapshot => ({
  tier: 'premium',
  unlimited: false,
  payer: 'macro|owner@example.com',
  can_manage_billing: true,
  seats,
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  included_cents: 4_000,
  used_cents: 1_000,
  credits_consumed_cents: 0,
  credit_balance_cents: 2_500,
  overage_enabled: true,
  overage_limit_cents: 5_000,
  overage_charged_cents: 1_000,
  overage_suspended: false,
  uncovered_cents: 0,
  remaining_cents: 10_500,
});

afterEach(cleanup);

describe('AiUsageMeter', () => {
  it('shows a team member their own allowance and shared billing balances', () => {
    render(() => <AiUsageMeter snapshot={snapshot(5)} />);

    expect(screen.getAllByText('$10')).toHaveLength(2);
    expect(screen.getByText(/of \$40 included/)).toBeTruthy();
    expect(screen.queryByText(/across 5 seats/)).toBeNull();
    expect(screen.getByText(/Team credits:/)).toBeTruthy();
    expect(screen.getByText(/Team usage billing this period/)).toBeTruthy();
  });

  it('uses personal labels outside a team', () => {
    render(() => <AiUsageMeter snapshot={snapshot(1)} />);

    expect(screen.getByText(/Credits:/)).toBeTruthy();
    expect(screen.getByText(/Usage billing this period/)).toBeTruthy();
    expect(screen.queryByText(/Team credits:/)).toBeNull();
  });
});
