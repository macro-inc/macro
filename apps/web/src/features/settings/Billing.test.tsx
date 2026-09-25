import { PLAN_FEATURES, type PlanTier } from '@app/features/paywall/plans';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Billing } from './Billing';

const state = vi.hoisted(() => ({ tier: 'premium' as PlanTier }));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/auth', () => ({
  useHasPaidAccess: () => () => state.tier !== 'free',
}));
vi.mock('@core/context/user', () => ({
  usePermissions: () => () => [PERMISSION_IDS.WRITE_STRIPE_SUBSCRIPTION],
  useUserId: () => () => 'macro|payer@example.com',
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/auth', () => ({
  useAiBillingSummaryQuery: () => ({
    isSuccess: true,
    data: {
      tier: state.tier,
      can_manage_billing: true,
      unlimited: false,
      used_cents: 1_000_000,
      included_cents: 4_000,
      credit_balance_cents: 0,
      blocked_reason: 'ai_allowance_exhausted',
    },
  }),
  useChangePlanMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateCheckoutSessionMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@service-stripe/client', () => ({
  stripeServiceClient: { createPortalSession: vi.fn() },
}));
vi.mock('./AiUsage', () => ({
  AiUsageMeter: () => {
    throw new Error('AI usage meter must not mount while billing is paused');
  },
  AiUsageControls: () => {
    throw new Error(
      'AI credit controls must not mount while billing is paused'
    );
  },
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: { children: JSX.Element }) => <>{props.children}</>,
  Button: (props: { children: JSX.Element }) => (
    <button type="button">{props.children}</button>
  ),
}));

afterEach(cleanup);

describe('Billing while AI usage billing is paused', () => {
  it.each<PlanTier>(['free', 'premium', 'max'])(
    'keeps %s subscription controls without usage or credit UI',
    (tier) => {
      state.tier = tier;
      const { container } = render(() => <Billing />);

      expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy();
      expect(container.textContent).not.toMatch(
        /AI usage|Add credits|Usage billing|included AI|out of credits/i
      );
      if (tier === 'free') {
        expect(
          screen.getByRole('button', { name: 'Upgrade now' })
        ).toBeTruthy();
      } else {
        expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
      }
    }
  );

  it('does not advertise credit or usage billing in the plan comparison', () => {
    expect(PLAN_FEATURES.map((feature) => feature.label)).not.toContain(
      'AI usage included'
    );
    expect(PLAN_FEATURES.map((feature) => feature.label)).not.toContain(
      'Beyond included'
    );
  });
});
