import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReturn } from '../core/checkout';
import {
  defaultFakeWorld,
  type FakeOnboardingWorld,
} from '../tests/fake-onboarding-context';
import { renderInviteOfferStub } from '../tests/invite-offer-stub';
import { renderWithFakeOnboarding } from '../tests/render';
import { PlanComparisonView } from './plan-comparison-view';
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

function setupComparison(world: Partial<FakeOnboardingWorld> = {}) {
  const checkout = vi.fn();
  const guest = vi.fn();
  const back = vi.fn();
  const { fake } = renderWithFakeOnboarding(
    () => (
      <PlanComparisonView
        disabled={false}
        onContinueFree={guest}
        onBackToPro={back}
        onStartMax={() => checkout('max', 'standard')}
      />
    ),
    world
  );
  return { checkout, guest, back, fake };
}

describe('live trial checkout', () => {
  it('offers Free, Pro, and Max with current catalog prices and allowances', () => {
    const catalog = defaultFakeWorld().planCatalog;
    catalog.plans[1].monthly_price_cents = 4500;
    catalog.plans[1].included_ai_cents_per_seat = 1750;
    const { checkout } = setupComparison({ planCatalog: catalog });
    for (const name of ['Free', 'Pro', 'Max']) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })
      ).toBeTruthy();
    }
    expect(
      screen.getByRole('columnheader', { name: /^Pro/ }).textContent
    ).toContain('$45');
    expect(screen.getByText('10× usage')).toBeTruthy();
    expect(screen.queryByText(/17.50/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Max' }));
    expect(checkout).toHaveBeenCalledWith('max', 'standard');
  });

  it('keeps Free available when the catalog fails and disables paid checkout', () => {
    const { checkout, guest } = setupComparison({
      failures: { planCatalog: 'Unavailable' },
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Continue with Max' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Pro' }));
    expect(checkout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Free' }));
    expect(guest).toHaveBeenCalledOnce();
    expect(checkout).not.toHaveBeenCalled();
  });

  it('does not sell an unavailable paid tier', () => {
    const catalog = defaultFakeWorld().planCatalog;
    catalog.plans[2].purchasable = false;
    setupComparison({ planCatalog: catalog });
    expect(
      screen
        .getByRole('button', { name: 'Continue with Max' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

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
      screen.getByRole('button', { name: 'Continue with Free instead' })
    );
    expect(guest).toHaveBeenCalledOnce();
  });
});
