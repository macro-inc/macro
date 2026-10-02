import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  track: vi.fn(),
  failure: vi.fn(),
  complete: vi.fn(),
  tutorial: vi.fn(),
  checkout: vi.fn(),
  params: {} as Record<string, string>,
  info: { tutorialComplete: true },
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.params],
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/auth', () => ({
  useCreateCheckoutSessionMutation: () => ({ mutateAsync: mocks.checkout }),
}));
vi.mock('@queries/auth/tutorial', () => ({
  useCompleteTutorialMutation: () => ({ mutateAsync: mocks.tutorial }),
}));
vi.mock('@queries/onboarding', () => ({
  useCompleteOnboardingMutation: () => ({ mutateAsync: mocks.complete }),
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    refetchQueries: async () => {},
    getQueryData: () => mocks.info,
  },
}));

import { createFlowFinish } from './createFlowFinish';
import { FLOW_NEXT_STORAGE_KEY, FLOW_STEP_STORAGE_KEY } from './shared';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.params = {};
  mocks.info = { tutorialComplete: true };
  mocks.complete.mockResolvedValue(undefined);
  mocks.tutorial.mockResolvedValue(undefined);
});

describe('onboarding completion', () => {
  it('keeps setup retryable and displays the reason when a trial is rejected', async () => {
    const message =
      'The 30-day trial is only available for your first Premium subscription';
    mocks.checkout.mockRejectedValue(new Error(message));
    sessionStorage.setItem(FLOW_STEP_STORAGE_KEY, 'plan');
    let dispose!: () => void;
    const finish = createRoot((cleanup) => {
      dispose = cleanup;
      return createFlowFinish();
    });
    try {
      await finish.startPremiumCheckout('premium');
      expect(mocks.checkout).toHaveBeenCalledWith(
        expect.objectContaining({ onboardingTrial: true })
      );
      expect(mocks.failure).toHaveBeenCalledWith(message);
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(FLOW_STEP_STORAGE_KEY)).toBe('plan');
      expect(finish.finishing()).toBe(false);
    } finally {
      dispose();
    }
  });
  it.each(['guest', 'paid'])(
    'keeps the original deep link when completing as %s',
    async (plan) => {
      sessionStorage.setItem(FLOW_NEXT_STORAGE_KEY, '/channel/example');
      sessionStorage.setItem(FLOW_STEP_STORAGE_KEY, 'saved');
      let dispose!: () => void;
      const finish = createRoot((cleanup) => {
        dispose = cleanup;
        return createFlowFinish();
      });
      try {
        if (plan === 'guest') await finish.finishFree();
        else await finish.finishPremium();
        expect(mocks.navigate).toHaveBeenCalledWith('/channel/example', {
          replace: true,
        });
        expect(sessionStorage.getItem(FLOW_NEXT_STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(FLOW_STEP_STORAGE_KEY)).toBeNull();
      } finally {
        dispose();
      }
    }
  );
  it('stays on setup with saved progress when completion fails', async () => {
    sessionStorage.setItem(FLOW_STEP_STORAGE_KEY, 'saved');
    mocks.complete.mockRejectedValue(new Error('offline'));
    let dispose!: () => void;
    const finish = createRoot((cleanup) => {
      dispose = cleanup;
      return createFlowFinish();
    });
    try {
      await finish.finishFree();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(FLOW_STEP_STORAGE_KEY)).toBe('saved');
      expect(mocks.failure).toHaveBeenCalledOnce();
      expect(finish.finishing()).toBe(false);
    } finally {
      dispose();
    }
  });
  it('does not enter the app until the tutorial flag is confirmed', async () => {
    mocks.info.tutorialComplete = false;
    let dispose!: () => void;
    const finish = createRoot((cleanup) => {
      dispose = cleanup;
      return createFlowFinish();
    });
    try {
      await finish.finishPremium();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.failure).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});
