import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBillingLab } from '../../billing-lab/create-billing-lab';
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

it('shows team-paid members only a team-managed notice for usage credits', () => {
  const lab = createBillingLab('team-member');
  render(() => <UsageSettingsView context={lab.usage} />);
  expect(
    screen.getByText('Usage credits are managed by your team.')
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add more' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add credits' })).toBeNull();
  expect(screen.queryByText(/credits remaining/)).toBeNull();
  expect(screen.queryByText('Automatic reload')).toBeNull();
  expect(screen.queryByRole('button', { name: /Automatic reload/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Adjust limit' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
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
