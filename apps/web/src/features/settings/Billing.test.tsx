import { type PlanTier, planFeatures } from '@app/features/paywall/plans';
import { PERMISSION_IDS } from '@core/constant/permissions';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Billing } from './Billing';

const state = vi.hoisted(() => ({
  tier: 'premium' as PlanTier,
  aiUsageBilling: false,
  summarySuccess: true,
  unlimited: false,
  toastSuccess: vi.fn(),
  changePlan: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableAiUsageBilling: { key: 'enable-ai-usage-billing', override: undefined },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: state.aiUsageBilling,
    payload: undefined,
    loading: false,
  }),
  ShowFeatureFlag: (props: {
    children: JSX.Element;
    fallback?: JSX.Element;
  }) => (
    <Show when={state.aiUsageBilling} fallback={props.fallback}>
      {props.children}
    </Show>
  ),
}));
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
  toast: { success: state.toastSuccess, failure: vi.fn() },
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/auth', () => ({
  useAiBillingSummaryQuery: () => ({
    isSuccess: state.summarySuccess,
    get data() {
      if (!state.summarySuccess) throw new Error('Read pending summary');
      return {
        tier: state.tier,
        can_manage_billing: true,
        unlimited: state.unlimited,
        used_cents: 1_000_000,
        included_cents: 4_000,
        credit_balance_cents: 0,
        blocked_reason: 'ai_allowance_exhausted',
      };
    },
  }),
  useChangePlanMutation: () => ({
    isPending: false,
    mutateAsync: state.changePlan,
  }),
  useCreateCheckoutSessionMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@service-stripe/client', () => ({
  stripeServiceClient: { createPortalSession: vi.fn() },
}));
vi.mock('./AiUsage', () => ({
  AiUsageMeter: () => <div data-testid="usage-meter">AI usage meter</div>,
  AiUsageControls: () => <div data-testid="usage-controls">Add credits</div>,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: { children: JSX.Element }) => <>{props.children}</>,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

afterEach(cleanup);

describe.each([false, true])(
  'Billing with enable-ai-usage-billing=%s',
  (aiUsageBilling) => {
    beforeEach(() => {
      state.aiUsageBilling = aiUsageBilling;
      state.tier = 'premium';
      state.summarySuccess = true;
      state.unlimited = false;
      state.toastSuccess.mockClear();
      state.changePlan.mockClear();
    });

    it.each<PlanTier>(['free', 'premium', 'max'])(
      'keeps %s subscription controls and gates usage UI and copy on the flag',
      (tier) => {
        state.tier = tier;
        const { container } = render(() => <Billing />);

        expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy();
        expect(screen.queryByTestId('usage-meter') !== null).toBe(
          aiUsageBilling && tier !== 'free'
        );
        expect(screen.queryByTestId('usage-controls') !== null).toBe(
          aiUsageBilling && tier !== 'free'
        );
        expect(container.textContent?.includes('of AI usage')).toBe(
          aiUsageBilling
        );
        if (!aiUsageBilling) {
          expect(container.textContent).not.toMatch(
            /AI usage|Add credits|Usage billing|included AI|out of credits/i
          );
        }
        expect(
          screen.getByRole('button', {
            name: tier === 'free' ? 'Upgrade now' : 'Manage',
          })
        ).toBeTruthy();
      }
    );

    it('gates usage-billing rows in the plan comparison on the flag', () => {
      const labels = planFeatures(aiUsageBilling).map(
        (feature) => feature.label
      );
      expect(labels.includes('AI usage included')).toBe(aiUsageBilling);
      expect(labels.includes('Beyond included')).toBe(aiUsageBilling);
      expect(labels).toContain('AI Agent');
      expect(labels).toContain('Storage');
    });

    it('does not read a pending billing summary', () => {
      state.summarySuccess = false;
      render(() => <Billing />);
      expect(screen.queryByTestId('usage-meter')).toBeNull();
      expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
    });

    it('keeps unlimited plans free of credit controls', () => {
      state.unlimited = true;
      render(() => <Billing />);
      expect(screen.queryByTestId('usage-controls')).toBeNull();
      expect(
        screen.queryByText(
          'Your enterprise plan includes unlimited AI usage.'
        ) !== null
      ).toBe(aiUsageBilling);
    });

    it.each<PlanTier>(['free', 'premium'])(
      'does not offer Max purchases from the %s plan',
      (tier) => {
        state.tier = tier;
        render(() => <Billing />);

        expect(screen.queryByRole('button', { name: 'Get Max' })).toBeNull();
        expect(
          screen.queryByRole('button', { name: 'Upgrade to Max' })
        ).toBeNull();
      }
    );

    it('keeps the current Max plan visible and allows a Premium downgrade', async () => {
      state.tier = 'max';
      render(() => <Billing />);

      expect(screen.getByRole('heading', { name: 'Max plan' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Get Max' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Upgrade to Max' })
      ).toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Switch to Premium' })
      );
      await waitFor(() =>
        expect(state.changePlan).toHaveBeenCalledWith({ plan: 'premium' })
      );
    });
  }
);
