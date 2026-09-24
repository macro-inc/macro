import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { For, type JSX, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnboardingHandoff } from '../core/onboardingHandoff';
import { writeOnboardingIntegrations } from '../core/onboardingIntegrations';
import { OnboardingFlow } from './OnboardingFlow';

const wiring = vi.hoisted(() => ({
  track: vi.fn(),
  navigate: vi.fn(),
  google: vi.fn(),
  finish: vi.fn(),
  finishPremium: vi.fn(),
  checkout: vi.fn(),
  invalidate: vi.fn(),
}));
const work = {
  email_address: 'work@company.com',
  macro_id: 'user-1',
  needs_reauth: false,
};
const [state, setState] = createStore({ links: [work], linksReady: true });
vi.mock('@solid-primitives/media', () => ({
  createMediaQuery: () => () => true,
}));
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: readonly unknown[];
    children: (row: unknown, index: () => number) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: wiring.track }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => () => true,
  useEmail: () => () => 'work@company.com',
  useUserId: () => () => 'user-1',
}));
vi.mock('@core/email-link', () => ({ useAddInboxFlow: () => wiring.google }));
vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => ({
    isSuccess: true,
    data: {
      authenticated: true,
      tutorialComplete: false,
      id: 'user-1',
      email: 'work@company.com',
    },
  }),
}));
vi.mock('@queries/auth/keys', () => ({
  authKeys: { userInfo: { queryKey: ['user-info'] } },
}));
vi.mock('@queries/auth/tutorial', () => ({
  useCompleteTutorialMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/client', () => ({
  queryClient: { refetchQueries: vi.fn() },
}));
vi.mock('@queries/import', () => ({ useImportQuery: () => ({}) }));
vi.mock('@queries/onboarding', () => ({
  useOnboardingQuery: () => ({
    isSuccess: true,
    data: { row: { status: 'active' } },
  }),
}));
vi.mock('@queries/gtm-invite/links', () => ({
  useGtmInviteOfferQuery: () => ({ isSuccess: true, data: null }),
}));
vi.mock('@queries/mcp-servers', () => ({
  useMcpServersQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectionsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => wiring.navigate }));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    get isSuccess() {
      return state.linksReady;
    },
    get isPending() {
      return !state.linksReady;
    },
    isError: false,
    isFetching: false,
    get data() {
      if (!state.linksReady) throw new Error('Unsettled links read');
      return { links: state.links };
    },
    refetch: vi.fn(),
  }),
  invalidateEmailLinks: wiring.invalidate,
}));
vi.mock('@ui', () => ({ Layer: () => null }));
vi.mock('../components/OnboardingShell', () => ({
  OnboardingShell: (props: { children?: JSX.Element }) => (
    <div class="onboarding-flow">
      <div data-onboarding-scroll>{props.children}</div>
    </div>
  ),
}));
vi.mock('../components/StoryStage', () => ({
  isStoryStep: (key: string) =>
    ['welcome', 'security', 'tools', 'vision'].includes(key),
  StoryStage: (props: {
    step: string;
    onNext: (features?: string[]) => void;
    children?: JSX.Element;
  }) => (
    <section>
      <h1 tabindex="-1">{props.step}</h1>
      <Show
        when={props.step === 'tools'}
        fallback={
          <button
            type="button"
            onClick={() =>
              props.onNext(
                props.step === 'vision' ? ['Email', 'Docs'] : undefined
              )
            }
          >
            Story next
          </button>
        }
      >
        {props.children}
      </Show>
    </section>
  ),
}));
vi.mock('@core/pipedream/flag', () => ({
  usePipedreamMcpFlag: () => () => false,
}));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogSearch: vi.fn(),
}));
vi.mock('@core/pipedream/ConnectorIcon', () => ({
  PipedreamConnectorIcon: () => <span aria-hidden="true" />,
}));
vi.mock('@core/component/AI/constant/mcpServers', () => ({
  pipedreamAppAvailableInEnv: () => true,
  FEATURED_MCP_SERVERS: [
    { app_slug: 'notion', server_name: 'Notion' },
    { app_slug: 'github', server_name: 'GitHub' },
    { app_slug: 'linear', server_name: 'Linear' },
  ],
}));
vi.mock('./ConnectorStep', () => ({
  ConnectorStep: (props: {
    integration: { name: string };
    onContinue: () => void;
    onSkip: () => void;
  }) => (
    <section>
      <h1>Connect {props.integration.name}</h1>
      <button type="button" onClick={props.onContinue}>
        Integration next
      </button>
      <button type="button" onClick={props.onSkip}>
        Skip integration
      </button>
    </section>
  ),
}));
vi.mock('./TeamStep', () => ({
  TeamStep: (props: { onContinue: () => void }) => (
    <>
      <button type="button" onClick={props.onContinue}>
        Create team
      </button>
    </>
  ),
}));
vi.mock('./PlanStep', () => ({
  PlanStep: (props: {
    onFree: (skipped: boolean) => void;
    onPremiumPaid: () => void;
    onStartCheckout: (tier: 'premium') => void;
  }) => (
    <>
      <p>Choose a plan</p>
      <button type="button" onClick={() => props.onFree(false)}>
        Continue free
      </button>
      <button type="button" onClick={() => props.onFree(true)}>
        Decide later
      </button>
      <button type="button" onClick={props.onPremiumPaid}>
        Payment confirmed
      </button>
      <button type="button" onClick={() => props.onStartCheckout('premium')}>
        Checkout
      </button>
    </>
  ),
}));
vi.mock('./createFlowFinish', () => ({
  createFlowFinish: () => ({
    finishing: () => false,
    afterTarget: () => '/home',
    finishFree: wiring.finish,
    startPremiumCheckout: wiring.checkout,
    finishPremium: wiring.finishPremium,
  }),
}));

const saveStep = (step: string, user = 'user-1') =>
  sessionStorage.setItem(
    'onboarding-flow-step',
    JSON.stringify({ user, step })
  );
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  setState({ links: [work], linksReady: true });
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('authenticated onboarding sequencing and resume', () => {
  it('goes from Welcome through Features and Security to required Google accounts', () => {
    const view = render(() => <OnboardingFlow />);
    expect(view.getByRole('heading', { name: 'welcome' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Story next' }));
    expect(view.getByRole('heading', { name: 'vision' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Story next' }));
    expect(view.getByRole('heading', { name: 'security' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Story next' }));
    expect(
      view.getByRole('heading', {
        name: 'Connect your work Google email and calendar.',
      })
    ).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'vision' })).toBeNull();
    expect(
      wiring.track.mock.calls.filter(
        ([event]) => event === 'onboarding_v4_features_selected'
      )
    ).toEqual([
      [
        'onboarding_v4_features_selected',
        {
          features: ['Email', 'Docs'],
          feature_count: 2,
          source: 'app_onboarding',
        },
      ],
    ]);
  });

  it('gates saved later steps until work is confirmed without overwriting the requested resume step', () => {
    saveStep('team');
    setState({ linksReady: false, links: [] });
    const view = render(() => <OnboardingFlow />);
    expect(
      view.getByRole('heading', {
        name: 'Connect your work Google email and calendar.',
      })
    ).toBeTruthy();
    expect(
      JSON.parse(sessionStorage.getItem('onboarding-flow-step') ?? '{}').step
    ).toBe('team');
    setState({
      linksReady: true,
      links: [{ ...work, email_address: 'personal@gmail.com' }],
    });
    expect(view.queryByRole('button', { name: 'Create team' })).toBeNull();
    setState('links', [work]);
    expect(
      view.getByRole('heading', { name: 'Built for teams.' })
    ).toBeTruthy();
  });

  it('keeps the real Tools search input and focus while selections add distinct steps', async () => {
    saveStep('tools');
    const view = render(() => <OnboardingFlow />);
    const input = view.getByRole('searchbox', {
      name: 'Search integrations and MCPs',
    }) as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'Notion' } });
    fireEvent.click(view.getByRole('button', { name: 'Select Notion' }));
    expect(view.getByRole('searchbox')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Notion');
    expect(view.getByRole('progressbar').getAttribute('aria-valuemax')).toBe(
      '9'
    );
    fireEvent.input(input, { target: { value: 'GitHub' } });
    fireEvent.click(view.getByRole('button', { name: 'Select GitHub' }));
    expect(view.getByRole('searchbox')).toBe(input);
    expect(view.getByRole('progressbar').getAttribute('aria-valuemax')).toBe(
      '10'
    );
    fireEvent.click(
      view.getByRole('button', { name: 'Continue with 2 integrations' })
    );
    expect(view.getByRole('heading', { name: 'Connect Notion' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Integration next' }));
    expect(view.getByRole('heading', { name: 'Connect GitHub' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Skip integration' }));
    expect(view.getByText('Choose a plan')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Continue free' }));
    expect(wiring.finish).not.toHaveBeenCalled();
    expect(
      view.getByRole('heading', { name: 'Built for teams.' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(wiring.finish).toHaveBeenCalledWith(false));
  });

  it('preserves a skipped plan when reloading the final team step', () => {
    saveStep('plan');
    const view = render(() => <OnboardingFlow />);
    fireEvent.click(view.getByRole('button', { name: 'Decide later' }));
    expect(
      view.getByRole('heading', { name: 'Built for teams.' })
    ).toBeTruthy();
    expect(wiring.finish).not.toHaveBeenCalled();
    view.unmount();
    const resumed = render(() => <OnboardingFlow />);
    expect(resumed.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '8'
    );
    fireEvent.click(resumed.getByRole('button', { name: 'Create team' }));
    expect(wiring.finish).toHaveBeenCalledWith(true);
  });

  it('keeps paid checkout incomplete until the final team step', () => {
    saveStep('plan');
    const view = render(() => <OnboardingFlow />);
    fireEvent.click(view.getByRole('button', { name: 'Checkout' }));
    expect(wiring.checkout).toHaveBeenCalledWith('premium');
    expect(wiring.finishPremium).not.toHaveBeenCalled();
    expect(view.queryByRole('button', { name: 'Create team' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Payment confirmed' }));
    expect(wiring.finishPremium).not.toHaveBeenCalled();
    view.unmount();
    const resumed = render(() => <OnboardingFlow />);
    fireEvent.click(resumed.getByRole('button', { name: 'Create team' }));
    expect(wiring.finishPremium).toHaveBeenCalledOnce();
    expect(wiring.finish).not.toHaveBeenCalled();
  });

  it('restores the exact selected integration after a provider round-trip', () => {
    saveStep('connect-github');
    writeOnboardingIntegrations(sessionStorage, 'user-1', [
      { id: 'notion', name: 'Notion' },
      { id: 'github', name: 'GitHub' },
    ]);
    const view = render(() => <OnboardingFlow />);
    expect(view.getByRole('heading', { name: 'Connect GitHub' })).toBeTruthy();
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '8'
    );
    fireEvent.click(view.getByRole('button', { name: '← Back' }));
    expect(view.getByRole('heading', { name: 'Connect Notion' })).toBeTruthy();
  });

  it('resumes public work signup at Google accounts and retains the safe app destination', () => {
    createOnboardingHandoff(sessionStorage, {
      next: '/app/component/channels',
    });
    const view = render(() => <OnboardingFlow />);
    expect(
      view.getByRole('heading', {
        name: 'Connect your work Google email and calendar.',
      })
    ).toBeTruthy();
    expect(sessionStorage.getItem('macro-onboarding-handoff-v1')).toBeNull();
    expect(sessionStorage.getItem('onboarding-flow-next')).toBe(
      '/component/channels'
    );
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(
      view.getByRole('heading', {
        name: 'Add your personal Google email and calendar.',
      })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Skip for now' }));
    expect(view.getByRole('searchbox')).toBeTruthy();
  });

  it('keeps the optional personal step behind the required work gate', () => {
    saveStep('personal');
    setState('links', [{ ...work, email_address: 'personal@gmail.com' }]);
    const view = render(() => <OnboardingFlow />);
    expect(
      view.getByRole('heading', {
        name: 'Connect your work Google email and calendar.',
      })
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    setState('links', [work]);
    expect(
      view.getByRole('heading', {
        name: 'Add your personal Google email and calendar.',
      })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Skip for now' }));
    expect(view.getByRole('searchbox')).toBeTruthy();
  });

  it('restores personal consent success on its own step, then continues to tools', () => {
    saveStep('personal');
    setState('links', [work, { ...work, email_address: 'personal@gmail.com' }]);
    sessionStorage.setItem(
      'onboarding-google-attempt',
      JSON.stringify({ user: 'user-1', slot: 'personal', count: 1 })
    );
    const view = render(() => <OnboardingFlow />);
    expect(
      view.getByRole('heading', {
        name: 'Add your personal Google email and calendar.',
      })
    ).toBeTruthy();
    expect(sessionStorage.getItem('onboarding-google-attempt')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Choose integrations' }));
    expect(view.getByRole('searchbox')).toBeTruthy();
  });

  it('does not apply another account’s stored step or chosen integrations', () => {
    saveStep('connect-notion', 'other-user');
    writeOnboardingIntegrations(sessionStorage, 'other-user', [
      { id: 'notion', name: 'Notion' },
    ]);
    const view = render(() => <OnboardingFlow />);
    expect(view.getByRole('heading', { name: 'welcome' })).toBeTruthy();
    expect(view.getByRole('progressbar').getAttribute('aria-valuemax')).toBe(
      '8'
    );
  });
});
