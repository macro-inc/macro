import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBillingLab } from '../../billing-lab/create-billing-lab';
import { fixtureSnapshot } from '../../billing-lab/queries/fixture-snapshot';
import { toUsageSummary } from '../queries/usage-summary';
import { UsageSettingsView } from './usage-settings';

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(['spending-limit', 'team-owner-spending-limit'] as const)(
  'lets the monthly cap notice open the real reload and credit dialogs in %s',
  (scenario) => {
    const lab = createBillingLab(scenario);
    render(() => <UsageSettingsView context={lab.usage} />);
    expect(
      screen.getByText('Monthly auto-reload $50 limit reached')
    ).toBeTruthy();
    expect(screen.getByText('resets Nov 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust limit' }));
    expect(screen.getByRole('dialog', { name: 'Auto-Reload' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Auto-Reload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(
      screen.getByRole('dialog', { name: 'Need more usage?' })
    ).toBeTruthy();
  }
);

it('lets a team owner recover a failed reload through the real controls', async () => {
  const lab = createBillingLab('team-owner-reload-paused');
  render(() => <UsageSettingsView context={lab.usage} />);
  expect(
    screen.getByText(/Paused — payment failed\. Update your payment/)
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Configure Automatic reload' })
  );
  expect(screen.getByRole('dialog', { name: 'Auto-Reload' })).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage payment methods' })
  );
  await waitFor(() => expect(lab.payment()).toEqual({ kind: 'methods' }));
  await lab.completePayment();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(lab.usage.autoReload.settings().enabled).toBe(true);
  expect(lab.usage.autoReload.suspended()).toBe(false);
});

it('does not infer a monthly cap-reached status without spend facts', () => {
  const lab = createBillingLab('spending-limit');
  render(() => (
    <UsageSettingsView
      context={{
        ...lab.usage,
        autoReload: { ...lab.usage.autoReload, budget: undefined },
      }}
    />
  ));
  expect(
    screen.queryByText('Monthly auto-reload $50 limit reached')
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Adjust limit' })).toBeNull();
});

it('shows a live decoded cap notice when the remaining budget cannot fund a minimum reload', () => {
  const lab = createBillingLab('pro');
  const snapshot = {
    ...fixtureSnapshot(lab.state()),
    overage_enabled: true,
    auto_reload: {
      minimum_balance_cents: 1_000,
      target_balance_cents: 10_000,
      monthly_spend_limit_cents: 5_000,
      suspended: false,
      active: true,
      monthly_budget: {
        committed_cents: 4_951,
        resets_at: '2026-11-01T00:00:00Z',
        limit_reached: true,
      },
    },
  };
  const summary = () => toUsageSummary(snapshot);
  render(() => (
    <UsageSettingsView
      context={{
        ...lab.usage,
        summary,
        autoReload: {
          ...lab.usage.autoReload,
          settings: () => summary().autoReload.settings,
          budget: () => summary().autoReload.budget,
        },
      }}
    />
  ));
  expect(
    screen.getByText('Monthly auto-reload $50 limit reached')
  ).toBeTruthy();
  expect(screen.getByText('resets Nov 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Adjust limit' })).toBeTruthy();
});

it('removes the cap notice when the simulated calendar month resets', () => {
  const lab = createBillingLab('spending-limit');
  render(() => <UsageSettingsView context={lab.usage} />);
  expect(
    screen.getByText('Monthly auto-reload $50 limit reached')
  ).toBeTruthy();
  lab.advance(20);
  expect(
    screen.queryByText('Monthly auto-reload $50 limit reached')
  ).toBeNull();
  expect(lab.usage.autoReload.settings().enabled).toBe(true);
});

it('lets team-paid members add credits within the team limit, without Auto-Reload', () => {
  const lab = createBillingLab('team-member');
  render(() => <UsageSettingsView context={lab.usage} />);
  expect(screen.getByText(/credits remaining/)).toBeTruthy();
  expect(
    screen.getByText(
      /You can add \$[\d,.]+ more this month, within your team's/
    )
  ).toBeTruthy();
  expect(screen.queryByText('Automatic reload')).toBeNull();
  expect(screen.queryByRole('button', { name: /Automatic reload/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
  expect(
    screen.getByText("Charged right away to your team owner's card on file.")
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Buy $25 in credits' })
  ).toBeTruthy();
});

it.each(['pro', 'team-owner'] as const)(
  'preserves credit purchases for a %s payer',
  (scenario) => {
    const lab = createBillingLab(scenario);
    render(() => <UsageSettingsView context={lab.usage} />);
    if (scenario === 'team-owner') {
      expect(
        screen.getByText('This is your personal monthly usage limit.')
      ).toBeTruthy();
      expect(screen.getByText('Team Usage Credits')).toBeTruthy();
      expect(
        screen.getByText('Credits are shared by your entire team.')
      ).toBeTruthy();
      expect(screen.getByText('Shared team balance')).toBeTruthy();
      expect(
        screen.getByText('Reloads credits for your entire team.')
      ).toBeTruthy();
    } else {
      expect(
        screen.queryByText('This is your personal monthly usage limit.')
      ).toBeNull();
      expect(screen.queryByText('Team Usage Credits')).toBeNull();
      expect(screen.getByText('Current balance')).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
    expect(
      screen.getByRole('dialog', { name: 'Need more usage?' })
    ).toBeTruthy();
    if (scenario === 'team-owner') {
      expect(
        screen.getByText('These credits are shared by your entire team.')
      ).toBeTruthy();
      expect(screen.getByText('Team usage credits')).toBeTruthy();
      fireEvent.click(
        screen.getByRole('button', { name: 'Close credit purchase' })
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Configure Automatic reload' })
      );
      expect(
        screen.getByText(
          'Auto-reload adds credits to your team’s shared balance.'
        )
      ).toBeTruthy();
    }
  }
);

it('keeps team credit labels and the personal allowance explanation for an owner with one seat', () => {
  const lab = createBillingLab('team-owner');
  const snapshot = { ...fixtureSnapshot(lab.state()), seats: 1 };
  render(() => (
    <UsageSettingsView
      context={{ ...lab.usage, summary: () => toUsageSummary(snapshot) }}
    />
  ));
  expect(
    screen.getByText('This is your personal monthly usage limit.')
  ).toBeTruthy();
  expect(screen.getByText('Team Usage Credits')).toBeTruthy();
  expect(
    screen.getByText('Credits are shared by your entire team.')
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
  expect(
    screen.getByText('These credits are shared by your entire team.')
  ).toBeTruthy();
});

it('sends a payer with no card on file to checkout for the same pack', async () => {
  const lab = createBillingLab('pro');
  const checkout = vi.fn(async () => 'https://checkout.stripe.test/session');
  const navigateToPayment = vi.fn();
  render(() => (
    <UsageSettingsView
      context={{
        ...lab.usage,
        creditPurchase: {
          ...lab.usage.creditPurchase,
          buy: async () => 'payment_method_required',
          checkout,
        },
        navigateToPayment,
      }}
    />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
  fireEvent.click(screen.getByRole('button', { name: 'Buy $25 in credits' }));

  await waitFor(() =>
    expect(navigateToPayment).toHaveBeenCalledWith(
      'https://checkout.stripe.test/session'
    )
  );
  expect(checkout).toHaveBeenCalledWith(2_500);
});

it('asks a team member to have the owner add a card when the team has none', async () => {
  const lab = createBillingLab('team-member');
  const checkout = vi.fn(async () => 'https://checkout.stripe.test/session');
  render(() => (
    <UsageSettingsView
      context={{
        ...lab.usage,
        creditPurchase: {
          ...lab.usage.creditPurchase,
          buy: async () => 'payment_method_required',
          checkout,
        },
      }}
    />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
  fireEvent.click(screen.getByRole('button', { name: 'Buy $25 in credits' }));

  expect(
    await screen.findByText(
      "Your team doesn't have a card on file. Ask your team owner to add one."
    )
  ).toBeTruthy();
  expect(checkout).not.toHaveBeenCalled();
});

it('sends a payer whose card needs authentication to checkout', async () => {
  const lab = createBillingLab('pro');
  const checkout = vi.fn(async () => 'https://checkout.stripe.test/session');
  const navigateToPayment = vi.fn();
  render(() => (
    <UsageSettingsView
      context={{
        ...lab.usage,
        creditPurchase: {
          ...lab.usage.creditPurchase,
          buy: async () => 'authentication_required',
          checkout,
        },
        navigateToPayment,
      }}
    />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
  fireEvent.click(screen.getByRole('button', { name: 'Buy $25 in credits' }));

  await waitFor(() =>
    expect(navigateToPayment).toHaveBeenCalledWith(
      'https://checkout.stripe.test/session'
    )
  );
  expect(checkout).toHaveBeenCalledWith(2_500);
});

it('asks a team member to have the owner verify a card that needs authentication', async () => {
  const lab = createBillingLab('team-member');
  const checkout = vi.fn(async () => 'https://checkout.stripe.test/session');
  render(() => (
    <UsageSettingsView
      context={{
        ...lab.usage,
        creditPurchase: {
          ...lab.usage.creditPurchase,
          buy: async () => 'authentication_required',
          checkout,
        },
      }}
    />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Add more' }));
  fireEvent.click(screen.getByRole('button', { name: 'Buy $25 in credits' }));

  expect(
    await screen.findByText(
      "Your team's card needs verification. Ask your team owner to buy credits or update the card."
    )
  ).toBeTruthy();
  expect(checkout).not.toHaveBeenCalled();
});
