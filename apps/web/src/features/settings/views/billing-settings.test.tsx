import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { BillingContext } from '../context/billing-context';
import { BillingSettingsView } from './billing-settings';

afterEach(cleanup);

function context(overrides: Partial<BillingContext> = {}): BillingContext {
  return {
    tier: () => 'max',
    renewalDate: () => '2026-11-01T12:00:00Z',
    scheduledChange: () => ({
      plan: 'premium',
      effectiveAt: '2026-11-01T12:00:00Z',
    }),
    hasPaid: () => true,
    aiUsageBilling: () => true,
    teamRole: () => undefined,
    teamSeatDescription: () => undefined,
    billedThroughTeam: () => false,
    isOwnerOrSolo: () => true,
    canManageSubscription: () => true,
    canChangePlan: () => true,
    changingPlan: () => false,
    checkout: async () => {},
    changePlan: async () => {},
    manage: async () => {},
    ...overrides,
  };
}

it('shows the future Pro date while Max remains current, and cancels using Max', () => {
  const keep = vi.fn();
  render(() => {
    const [change, setChange] = createSignal<
      { plan: 'premium'; effectiveAt: string } | undefined
    >({ plan: 'premium', effectiveAt: '2026-11-01T12:00:00Z' });
    return (
      <BillingSettingsView
        context={context({
          scheduledChange: change,
          changePlan: async (plan) => {
            keep(plan);
            setChange(undefined);
          },
        })}
      />
    );
  });
  expect(screen.getByRole('heading', { name: 'Max plan' })).toBeTruthy();
  expect(
    screen.getByText(/Your downgrade to Pro is scheduled/).textContent
  ).toContain('Nov 1, 2026');
  expect(screen.queryByRole('button', { name: 'Switch to Pro' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Keep Max plan' }));
  expect(keep).toHaveBeenCalledWith('max');
  expect(screen.queryByText(/Your downgrade to Pro/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Switch to Pro' })).toBeNull();
});

it('keeps a pending notice visible during mutation and hides the action from team members', () => {
  const { unmount } = render(() => (
    <BillingSettingsView context={context({ changingPlan: () => true })} />
  ));
  expect(
    (screen.getByRole('button', { name: 'Keep Max plan' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  unmount();
  render(() => (
    <BillingSettingsView context={context({ canChangePlan: () => false })} />
  ));
  expect(screen.getByText(/Your downgrade to Pro is scheduled/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Keep Max plan' })).toBeNull();
});

it('offers a retry when subscription state fails instead of inventing a renewal date', () => {
  const refresh = vi.fn();
  render(() => (
    <BillingSettingsView
      context={context({
        scheduledChange: () => undefined,
        renewalDate: () => undefined,
        subscriptionStatusFailed: () => true,
        refreshStatus: refresh,
      })}
    />
  ));
  expect(screen.queryByText(/Your current billing period ends/)).toBeNull();
  expect(screen.queryByText(/Your downgrade/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refresh).toHaveBeenCalledOnce();
});
