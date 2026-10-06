import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeOnboarding,
  type FakeOnboardingWorld,
} from '../tests/fake-onboarding-context';
import { createFlowFinish } from './flow-finish';
import {
  readSavedNext,
  readSavedStep,
  saveNext,
  saveStep,
} from './flow-storage';

const VIEWER = 'macro|ada@acme.com';

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());
beforeEach(() => sessionStorage.clear());

function setup(world: Partial<FakeOnboardingWorld> = {}, next?: string) {
  const fake = createFakeOnboarding(world);
  const navigate = vi.fn();
  const redirect = vi.fn();
  const finish = createRoot((cleanup) => {
    dispose = cleanup;
    return createFlowFinish(fake.context, {
      next: () => next,
      onNavigate: navigate,
      onRedirect: redirect,
    });
  });
  return { fake, finish, navigate, redirect };
}

describe('leaving onboarding', () => {
  it('keeps setup retryable and shows the reason when a trial is rejected', async () => {
    const message =
      'The 30-day trial is only available for your first Premium subscription';
    saveStep(VIEWER, 'plan');
    const { fake, finish, navigate, redirect } = setup({
      failures: { checkout: message },
    });
    await finish.startPremiumCheckout('premium');
    expect(fake.notifications()).toEqual([
      'The 30-day trial is only available for your first Pro subscription',
    ]);
    expect(fake.calls()).not.toContain('completeOnboarding');
    expect(navigate).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(readSavedStep(VIEWER)).toBe('plan');
    expect(finish.finishing()).toBe(false);
  });

  it('hands the page to checkout and stays busy while it unloads', async () => {
    const { finish, redirect } = setup();
    await finish.startPremiumCheckout('premium');
    expect(redirect).toHaveBeenCalledWith(
      'https://checkout.stripe.test/premium'
    );
    expect(finish.finishing()).toBe(true);
  });

  it.each(['guest', 'paid'] as const)(
    'returns to the original deep link when completing as %s',
    async (plan) => {
      saveNext('/channel/example');
      saveStep(VIEWER, 'plan');
      const { fake, finish, navigate } = setup();
      if (plan === 'guest') await finish.finishFree();
      else await finish.finishPremium('max');
      expect(navigate).toHaveBeenCalledWith('/channel/example');
      expect(readSavedNext()).toBeUndefined();
      expect(readSavedStep(VIEWER)).toBeUndefined();
      expect(finish.finishing()).toBe(true);
      expect(fake.events().at(-1)).toEqual({
        event: 'onboarding_v4_completed',
        data: expect.objectContaining({
          plan: plan === 'guest' ? 'free' : 'max',
          plan_skipped: false,
        }),
      });
    }
  );

  it('prefers the live ?next over the saved one, and remembers it for OAuth returns', async () => {
    saveNext('/md/older');
    const { finish, navigate } = setup({}, '/channel/live');
    expect(readSavedNext()).toBe('/channel/live');
    await finish.finishFree();
    expect(navigate).toHaveBeenCalledWith('/channel/live');
  });

  it('lands on Home without a deep link', async () => {
    const { finish, navigate } = setup({}, '/home');
    await finish.finishFree(true);
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('stays on setup with saved progress when completion fails', async () => {
    saveStep(VIEWER, 'team');
    const { fake, finish, navigate } = setup({
      failures: { completion: 'offline' },
    });
    await finish.finishFree();
    expect(navigate).not.toHaveBeenCalled();
    expect(readSavedStep(VIEWER)).toBe('team');
    expect(fake.notifications()).toHaveLength(1);
    expect(finish.finishing()).toBe(false);
  });

  it('lets staff bypass from any step, recorded as skipped and landing in the app', async () => {
    saveStep(VIEWER, 'tools');
    const { fake, finish, navigate } = setup();
    await finish.bypass('tools');
    expect(fake.calls()).toContain('completeOnboarding:skipped');
    expect(fake.events()).toEqual([
      { event: 'onboarding_v4_bypassed', data: { step: 'tools' } },
    ]);
    expect(navigate).toHaveBeenCalledWith('/home');
    expect(readSavedStep(VIEWER)).toBeUndefined();
  });

  it('keeps the deep link when bypassing', async () => {
    const { finish, navigate } = setup({}, '/channel/launch');
    await finish.bypass('welcome');
    expect(navigate).toHaveBeenCalledWith('/channel/launch');
  });
});
