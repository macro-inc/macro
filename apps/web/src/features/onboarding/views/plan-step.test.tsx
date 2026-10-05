import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReturn } from '../core/checkout';
import type { FakeOnboardingWorld } from '../tests/fake-onboarding-context';
import { renderWithFakeOnboarding } from '../tests/render';
import { PlanStep } from './plan-step';

afterEach(cleanup);

function setup(
  checkoutReturn: CheckoutReturn | undefined,
  world: Partial<FakeOnboardingWorld> = {}
) {
  const checkout = vi.fn();
  const finish = vi.fn().mockResolvedValue(undefined);
  const { fake } = renderWithFakeOnboarding(
    () => (
      <PlanStep
        checkoutReturn={checkoutReturn}
        finishing={false}
        onStartCheckout={checkout}
        onPremiumPaid={finish}
      />
    ),
    world
  );
  return { checkout, finish, fake };
}

describe('live trial checkout', () => {
  it('starts hosted checkout without collecting payment details locally', () => {
    const { checkout, finish } = setup(undefined);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start 30 day trial' }));
    expect(checkout).toHaveBeenCalledWith('premium');
    expect(finish).not.toHaveBeenCalled();
  });

  it('finishes only after the server confirms the license, with the returned tier', async () => {
    const { finish, checkout, fake } = setup(
      { t: 'success', tier: 'max' },
      { webhookPollsRemaining: 2 }
    );
    await waitFor(() => expect(finish).toHaveBeenCalledWith('max'), {
      timeout: 3_000,
    });
    expect(fake.calls().filter((c) => c === 'refreshViewer')).toHaveLength(2);
    expect(fake.events()).toContainEqual({
      event: 'subscription_success',
      data: { type: 'max' },
    });
    expect(checkout).not.toHaveBeenCalled();
  });

  it('does not treat a success URL alone as payment confirmation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { finish, fake } = setup({ t: 'success', tier: 'premium' });
      await vi.runAllTimersAsync();
      await screen.findByRole('alert');
      expect(finish).not.toHaveBeenCalled();

      fake.update((draft) => {
        if (draft.viewer) draft.viewer.licensed = true;
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to workspace' })
      );
      await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves cancellation retryable without completing onboarding', () => {
    const { finish } = setup({ t: 'cancelled' });
    expect(
      screen.getByRole('button', { name: 'Start 30 day trial' })
    ).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
  });

  it('lets existing paid members finish without buying again', async () => {
    const { finish, checkout } = setup(undefined, {
      viewer: {
        id: 'macro|paid@acme.com',
        email: 'paid@acme.com',
        tutorialComplete: false,
        licensed: true,
      },
    });
    await waitFor(() => expect(finish).toHaveBeenCalledWith('premium'));
    expect(checkout).not.toHaveBeenCalled();
  });
});
