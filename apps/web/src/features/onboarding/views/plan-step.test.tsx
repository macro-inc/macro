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

it('offers paid Pro without trial copy to an ineligible returning customer', () => {
  const { checkout } = setup(undefined, { trialEligible: false });
  expect(screen.queryByText(/Free Claude & GPT/)).toBeNull();
  expect(screen.queryByText(/first 30 days/)).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Start 30 day trial' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Get Pro' }));
  expect(checkout).toHaveBeenCalledWith('premium', 'standard');
});

it('offers a retry without advertising a trial or starting checkout when eligibility fails', () => {
  const { checkout, fake } = setup(undefined, {
    failures: { trialEligibility: 'offline' },
  });
  expect(screen.queryByText(/Free Claude & GPT/)).toBeNull();
  const button = screen.getByRole('button', { name: 'Get Pro' });
  expect(button.hasAttribute('disabled')).toBe(true);
  fireEvent.click(button);
  expect(checkout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(fake.calls()).toContain('retryTrialEligibility');
});

it('routes an existing subscription to management without starting a replacement checkout', () => {
  const { checkout, fake } = setup(undefined, {
    trialEligible: false,
    existingSubscription: true,
  });
  expect(screen.queryByText('Start 30 day trial')).toBeNull();
  expect(screen.queryByText('$40/user/month, billed monthly')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
  expect(fake.calls()).toContain('manageSubscription');
  expect(checkout).not.toHaveBeenCalled();
});

it('keeps known subscription management available when eligibility refresh fails', () => {
  const { checkout, fake } = setup(undefined, {
    trialEligible: false,
    existingSubscription: true,
    failures: { trialEligibility: 'offline' },
  });
  const manage = screen.getByRole('button', { name: 'Manage subscription' });
  expect(manage.hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText("Couldn't confirm your Pro offer.")).toBeNull();
  fireEvent.click(manage);
  expect(fake.calls()).toContain('manageSubscription');
  expect(checkout).not.toHaveBeenCalled();
});

it('does not expose an invite checkout when eligibility fails', () => {
  const { checkout } = setup(undefined, {
    inviteOffer: {
      firstName: 'Ada',
      freeMonths: 3,
      linkId: 'link-1',
      promoCode: 'ADA3',
      redeemedAt: '2026-10-01T00:00:00Z',
    },
    failures: { trialEligibility: 'offline' },
  });
  expect(
    screen.queryByRole('button', { name: 'Claim your free months' })
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Get Pro' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(checkout).not.toHaveBeenCalled();
});

it('does not advertise a trial in the comparison to a returning customer', () => {
  const { back, checkout } = setupComparison({ trialEligible: false });
  expect(screen.queryByText(/30 days free/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Pro' }));
  expect(back).toHaveBeenCalledOnce();
  expect(checkout).not.toHaveBeenCalled();
});

it('prevents replacement purchases from the comparison for an existing subscription', () => {
  setupComparison({ trialEligible: false, existingSubscription: true });
  expect(
    screen
      .getByRole('button', { name: 'Continue with Max' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Continue with Pro' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Continue with Free' })
      .hasAttribute('disabled')
  ).toBe(false);
});
