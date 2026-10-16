import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Billing } from './Billing';
import { BillingSettingsView } from './components/billing-settings-view';
import { getBillingState } from './core/billing-state';

const mocks = vi.hoisted(() => ({
  teamReady: true,
  eligibility: {
    isSuccess: true,
    isPending: false,
    isError: false,
    data: { eligible: false, existingSubscription: false },
    refetch: vi.fn(),
  },
  checkout: vi.fn(() => new Promise<string>(() => {})),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@core/auth', () => ({ useHasPaidAccess: () => () => false }));
vi.mock('@core/constant/featureFlags', () => ({
  LOCAL_ONLY: false,
  enableAiUsageBilling: {},
}));
vi.mock('@core/context/user', () => ({
  usePermissions: () => () => ['write:stripe_subscription'],
  useUserId: () => () => 'macro|returning@example.com',
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: mocks.teamReady,
    isPending: false,
    data: undefined,
  }),
}));
vi.mock('@queries/auth', () => ({
  useAiBillingSummaryQuery: () => ({
    isSuccess: true,
    data: { tier: 'free', can_manage_billing: true },
  }),
  useSubscriptionStatusQuery: () => ({ isPending: true }),
  useTrialEligibilityQuery: () => mocks.eligibility,
  useChangePlanMutation: () => ({ isPending: false }),
  useCreateCheckoutSessionMutation: () => ({
    isPending: false,
    mutateAsync: mocks.checkout,
  }),
}));
vi.mock('@service-stripe/client', () => ({ stripeServiceClient: {} }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));

beforeEach(() => {
  mocks.checkout.mockClear();
  mocks.teamReady = true;
  Object.assign(mocks.eligibility, {
    isSuccess: true,
    isPending: false,
    isError: false,
    data: { eligible: false, existingSubscription: false },
  });
});
afterEach(cleanup);

it.each([true, false])(
  'Billing sends the terms it advertises (eligible=%s)',
  (eligible) => {
    mocks.eligibility.data.eligible = eligible;
    render(() => <Billing />);
    expect(screen.queryByText('Free for one month!') !== null).toBe(eligible);
    fireEvent.click(screen.getByRole('button', { name: 'Get Pro' }));
    expect(mocks.checkout).toHaveBeenCalledWith({
      plan: 'premium',
      onboardingTrial: eligible,
    });
  }
);

it.each(['loading', 'error'])(
  'does not sell Pro on unconfirmed terms while eligibility is %s',
  (status) => {
    Object.assign(mocks.eligibility, {
      isSuccess: false,
      isPending: status === 'loading',
      isError: status === 'error',
    });
    render(() => <Billing />);
    expect(screen.queryByText('Free for one month!')).toBeNull();
    const button = screen.getByRole('button', { name: 'Get Pro' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(mocks.checkout).not.toHaveBeenCalled();
    if (status === 'error') {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(mocks.eligibility.refetch).toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Get Max' }));
    expect(mocks.checkout).toHaveBeenCalledWith({
      plan: 'max',
      onboardingTrial: false,
    });
  }
);

it('shows subscription management rather than replacement plans for a recoverable subscription', () => {
  mocks.eligibility.data.existingSubscription = true;
  render(() => <Billing />);
  expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Get Max' })).toBeNull();
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it('keeps Max upgrades available after paid access recovers while eligibility data is retained', () => {
  const select = vi.fn();
  render(() => (
    <BillingSettingsView
      state={getBillingState({
        hasPaid: true,
        canManageSubscription: true,
        aiUsageEnabled: true,
        pending: false,
        existingSubscription: true,
        summary: { tier: 'premium', canManageBilling: true },
      })}
      onManage={() => {}}
      onSelectPlan={select}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Max' }));
  expect(select).toHaveBeenCalledWith('max');
});

it('keeps known subscription management available after a failed eligibility refresh', () => {
  Object.assign(mocks.eligibility, {
    isSuccess: false,
    isPending: false,
    isError: true,
    data: { eligible: false, existingSubscription: true },
  });
  render(() => <Billing />);
  expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Get Max' })).toBeNull();
});

it('keeps management available when team lookup fails without enabling plan changes', () => {
  mocks.teamReady = false;
  mocks.eligibility.data.existingSubscription = true;
  render(() => <Billing />);
  expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  expect(screen.getByText(/Use Manage to review/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).toBeNull();
});

it('does not direct a user without billing permission to a hidden Manage action', () => {
  render(() => (
    <BillingSettingsView
      state={getBillingState({
        hasPaid: false,
        canManageSubscription: false,
        aiUsageEnabled: false,
        pending: false,
        existingSubscription: true,
      })}
      onManage={() => {}}
      onSelectPlan={() => {}}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
  expect(screen.queryByText(/Use Manage to review/)).toBeNull();
});

it('hides a previously confirmed trial after its background refresh fails', () => {
  Object.assign(mocks.eligibility, {
    isSuccess: false,
    isPending: false,
    isError: true,
    data: { eligible: true, existingSubscription: false },
  });
  render(() => <Billing />);
  expect(screen.queryByText('Free for one month!')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Get Pro' }).hasAttribute('disabled')
  ).toBe(true);
});
