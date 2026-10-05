import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReturn } from '../core/checkout';
import type { FakeOnboardingWorld } from '../tests/fake-onboarding-context';
import { renderInviteOfferStub } from '../tests/invite-offer-stub';
import { renderWithFakeOnboarding } from '../tests/render';
import { PlanStep } from './plan-step';

afterEach(cleanup);

function setup(
  checkoutReturn: CheckoutReturn | undefined,
  world: Partial<FakeOnboardingWorld> = {}
) {
  const checkout = vi.fn();
  const finish = vi.fn().mockResolvedValue(undefined);
  const guest = vi.fn();
  const { fake } = renderWithFakeOnboarding(
    () => (
      <PlanStep
        checkoutReturn={checkoutReturn}
        finishing={false}
        onStartCheckout={checkout}
        onPremiumPaid={finish}
        onContinueFree={guest}
        renderInviteOffer={renderInviteOfferStub}
      />
    ),
    world
  );
  return { checkout, finish, guest, fake };
}

describe('live trial checkout', () => {
  it('starts hosted checkout without collecting payment details locally', () => {
    const { checkout, finish } = setup(undefined);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start 30 day trial' }));
    expect(checkout).toHaveBeenCalledWith('premium', 'trial');
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
    expect(
      screen.queryByRole('heading', { name: 'Free Claude & GPT for 30 days.' })
    ).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Your workspace is ready.' })
    ).toBeTruthy();
    await waitFor(() => expect(finish).toHaveBeenCalledWith('premium'));
    expect(checkout).not.toHaveBeenCalled();
  });

  it('offers an invite’s free months instead of the trial, with paid terms', () => {
    const { checkout, guest } = setup(undefined, {
      inviteOffer: {
        firstName: 'Ada',
        freeMonths: 3,
        linkId: 'link-1',
        promoCode: 'ADA3',
        redeemedAt: '2026-10-01T00:00:00Z',
      },
    });
    expect(
      screen.queryByRole('button', { name: 'Start 30 day trial' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Claim your free months' })
    );
    expect(checkout).toHaveBeenCalledWith('premium', 'invite-offer');
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue as Guest instead' })
    );
    expect(guest).toHaveBeenCalledOnce();
  });
});
