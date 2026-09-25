import type { PlanTier } from '@app/features/paywall/plans';
import { PERMISSION_IDS } from '@core/constant/permissions';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const state = vi.hoisted(() => ({
  tier: 'premium' as PlanTier,
  dev: false,
  summarySuccess: true,
  unlimited: false,
  toastSuccess: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  get DEV_MODE_ENV() {
    return state.dev;
  },
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
  useChangePlanMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
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

describe.each([false, true])('Billing with DEV_MODE_ENV=%s', (dev) => {
  let Billing: typeof import('./Billing').Billing;
  let PLAN_FEATURES: typeof import('@app/features/paywall/plans').PLAN_FEATURES;

  beforeAll(async () => {
    state.dev = dev;
    vi.resetModules();
    ({ Billing } = await import('./Billing'));
    ({ PLAN_FEATURES } = await import('@app/features/paywall/plans'));
  });

  beforeEach(() => {
    state.tier = 'premium';
    state.summarySuccess = true;
    state.unlimited = false;
    state.toastSuccess.mockClear();
  });

  it.each<PlanTier>(['free', 'premium', 'max'])(
    'keeps %s subscription controls and gates usage UI and copy on dev',
    (tier) => {
      state.tier = tier;
      const { container } = render(() => <Billing />);

      expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy();
      expect(screen.queryByTestId('usage-meter') !== null).toBe(
        dev && tier !== 'free'
      );
      expect(screen.queryByTestId('usage-controls') !== null).toBe(
        dev && tier !== 'free'
      );
      expect(container.textContent?.includes('of AI usage')).toBe(dev);
      if (!dev) {
        expect(container.textContent).not.toMatch(
          /AI usage|Add credits|Usage billing|included AI|out of credits/i
        );
      }
      expect(
        screen.getByRole('button', {
          name: tier === 'free' ? 'Upgrade now' : 'Manage',
        })
      ).toBeTruthy();
      if (tier === 'premium') {
        expect(
          screen.getByText(dev ? 'Need more AI?' : 'Upgrade')
        ).toBeTruthy();
      }
    }
  );

  it('gates usage-billing rows in the plan comparison on dev', () => {
    const labels = PLAN_FEATURES.map((feature) => feature.label);
    expect(labels.includes('AI usage included')).toBe(dev);
    expect(labels.includes('Beyond included')).toBe(dev);
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
    ).toBe(dev);
  });

  it('only advertises an increased allowance in the dev upgrade toast', async () => {
    render(() => <Billing />);
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Max' }));
    await waitFor(() =>
      expect(state.toastSuccess).toHaveBeenCalledWith(
        dev
          ? 'Upgraded to Max. Your larger AI allowance applies right away.'
          : 'Upgraded to Max.'
      )
    );
  });
});
