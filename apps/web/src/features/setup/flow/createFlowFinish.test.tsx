import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlowFinish } from './createFlowFinish';

const wiring = vi.hoisted(() => ({
  next: undefined as string | undefined,
  tutorialComplete: true,
  navigate: vi.fn(),
  completeOnboarding: vi.fn(),
  completeTutorial: vi.fn(),
  refetch: vi.fn(),
  failure: vi.fn(),
  track: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock('@app/constants/defaultRoute', () => ({
  AFTER_SETUP_ROUTE: '/getting-started',
  DEFAULT_ROUTE: '/home',
}));
vi.mock('@app/features/onboarding/use-onboarding-checkout', () => ({
  createOnboardingCheckoutSession: wiring.checkout,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: wiring.track }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: wiring.failure },
}));
vi.mock('@queries/auth/keys', () => ({
  authKeys: { userInfo: { queryKey: ['user-info'] } },
}));
vi.mock('@queries/auth/tutorial', () => ({
  useCompleteTutorialMutation: () => ({ mutateAsync: wiring.completeTutorial }),
}));
vi.mock('@queries/onboarding', () => ({
  useCompleteOnboardingMutation: () => ({
    mutateAsync: wiring.completeOnboarding,
  }),
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    refetchQueries: wiring.refetch,
    getQueryData: () => ({ tutorialComplete: wiring.tutorialComplete }),
  },
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => wiring.navigate,
  useSearchParams: () => [
    {
      get next() {
        return wiring.next;
      },
    },
  ],
}));
vi.mock('@ui', () => ({ Layer: () => null }));

const setup = () => {
  let flow!: ReturnType<typeof createFlowFinish>;
  render(() => {
    flow = createFlowFinish({
      completionRollup: () => ({
        emails_connected: 2,
        connectors_connected: ['notion'],
      }),
    });
    return null;
  });
  return flow;
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  wiring.next = undefined;
  wiring.tutorialComplete = true;
  wiring.completeOnboarding.mockResolvedValue(undefined);
  wiring.completeTutorial.mockResolvedValue(undefined);
  wiring.refetch.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('onboarding completion', () => {
  it.each(['free', 'premium'] as const)(
    'keeps the OAuth-return deep link when finishing %s, then clears progress',
    async (plan) => {
      sessionStorage.setItem(
        'onboarding-flow-step',
        JSON.stringify({ user: 'user-1', step: 'plan' })
      );
      sessionStorage.setItem(
        'onboarding-flow-next',
        '/invite/team/invitation-1'
      );
      const flow = setup();
      if (plan === 'free') await flow.finishFree(true);
      else await flow.finishPremium();
      expect(wiring.completeOnboarding).toHaveBeenCalledWith({
        skipped: false,
      });
      expect(wiring.completeTutorial).toHaveBeenCalledOnce();
      expect(wiring.navigate).toHaveBeenCalledWith(
        '/invite/team/invitation-1',
        { replace: true }
      );
      expect(sessionStorage.getItem('onboarding-flow-step')).toBeNull();
      expect(sessionStorage.getItem('onboarding-flow-next')).toBeNull();
      expect(wiring.track).toHaveBeenCalledWith('onboarding_v4_completed', {
        plan,
        plan_skipped: plan === 'free',
        emails_connected: 2,
        connectors_connected: ['notion'],
      });
      expect(flow.finishing()).toBe(false);
    }
  );

  it('prefers a current safe next parameter over previously saved navigation', async () => {
    sessionStorage.setItem('onboarding-flow-next', '/old-destination');
    wiring.next = '/component/channels';
    const flow = setup();
    await flow.finishFree();
    expect(wiring.navigate).toHaveBeenCalledWith('/component/channels', {
      replace: true,
    });
  });

  it.each(['//outside.example', '/\\outside.example'])(
    'never sends onboarding completion to an external target %s',
    async (next) => {
      wiring.next = next;
      sessionStorage.setItem('onboarding-flow-next', next);
      const flow = setup();
      await flow.finishFree();
      expect(wiring.navigate).toHaveBeenCalledWith('/getting-started', {
        replace: true,
      });
    }
  );

  it('preserves the resume destination and allows retry when the server rejects completion', async () => {
    sessionStorage.setItem('onboarding-flow-next', '/component/calendar');
    sessionStorage.setItem('onboarding-flow-step', 'plan');
    wiring.completeOnboarding.mockRejectedValueOnce(new Error('offline'));
    const flow = setup();
    await flow.finishFree();
    expect(wiring.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('onboarding-flow-step')).toBe('plan');
    expect(sessionStorage.getItem('onboarding-flow-next')).toBe(
      '/component/calendar'
    );
    expect(wiring.failure).toHaveBeenCalledOnce();
    expect(flow.finishing()).toBe(false);
    await flow.finishFree();
    expect(wiring.navigate).toHaveBeenCalledWith('/component/calendar', {
      replace: true,
    });
  });

  it('waits for confirmed tutorial completion rather than routing into the redirect loop', async () => {
    wiring.tutorialComplete = false;
    sessionStorage.setItem('onboarding-flow-next', '/component/calendar');
    const flow = setup();
    await flow.finishPremium();
    expect(wiring.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('onboarding-flow-next')).toBe(
      '/component/calendar'
    );
    expect(wiring.failure).toHaveBeenCalledOnce();
  });

  it('coalesces repeated completion clicks while the first server write is pending', async () => {
    let resolve!: () => void;
    wiring.completeOnboarding.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      })
    );
    const flow = setup();
    const first = flow.finishFree();
    expect(flow.finishing()).toBe(true);
    await flow.finishPremium();
    expect(wiring.completeOnboarding).toHaveBeenCalledOnce();
    resolve();
    await first;
    expect(wiring.navigate).toHaveBeenCalledOnce();
  });
});
