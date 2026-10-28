import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { getFreePlanCheckoutRequest } from '../core/billing-state';
import { BillingPlanCard } from './billing-plan-card';

afterEach(cleanup);

it.each([true, false, undefined])(
  'only advertises and requests a confirmed trial (eligible=%s)',
  (trialEligible) => {
    const checkout = vi.fn();
    render(() => (
      <BillingPlanCard
        plan="premium"
        state={{
          hasPaid: false,
          aiUsageEnabled: false,
          pending: false,
          trialEligible,
        }}
        onSelectPlan={(plan) =>
          checkout(getFreePlanCheckoutRequest(plan, trialEligible === true))
        }
      />
    ));
    expect(screen.queryByText('Free for one month!') !== null).toBe(
      trialEligible === true
    );
    const button = screen.getByRole('button', { name: 'Get Pro' });
    expect(button.hasAttribute('disabled')).toBe(trialEligible === undefined);
    fireEvent.click(button);
    if (trialEligible === undefined) {
      expect(checkout).not.toHaveBeenCalled();
    } else {
      expect(checkout).toHaveBeenCalledWith({
        plan: 'premium',
        onboardingTrial: trialEligible,
      });
    }
  }
);
