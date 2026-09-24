import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useIsAuthenticated } from '@core/context/user';
import LogoIcon from '@icon/macro-logo.svg';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useEmailLinksQuery } from '@queries/email/link';
import { useGtmInviteOfferQuery } from '@queries/gtm-invite/links';
import { useImportQuery } from '@queries/import';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { useOnboardingQuery } from '@queries/onboarding';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { useNavigate } from '@solidjs/router';
import {
  batch,
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { OnboardingShell } from '../components/OnboardingShell';
import { OnboardingTrustDetails } from '../components/OnboardingTrustDetails';
import { isStoryStep, StoryStage } from '../components/StoryStage';
import { TeamSetup } from '../components/TeamSetup';
import { resolveGoogleAccounts } from '../core/googleAccounts';
import { consumeOnboardingHandoff } from '../core/onboardingHandoff';
import {
  type OnboardingIntegration,
  readOnboardingIntegrations,
  writeOnboardingIntegrations,
} from '../core/onboardingIntegrations';
import { onboardingStepKeys, resolveSetupStep } from '../core/onboardingSteps';
import { transitionOnboardingStep } from '../primitives/animateOnboardingStep';
import { animateSecurityHandoff } from '../primitives/animateSecurityHandoff';
import { ConnectorStep } from './ConnectorStep';
import { createFlowFinish } from './createFlowFinish';
import { EmailStep } from './EmailStep';
import {
  ONBOARDING_CONNECTORS_FEATURE_FLAG,
  resolveOnboardingConnectorNames,
} from './onboardingConnectorConfig';
import { PlanStep } from './PlanStep';
import { FLOW_NEXT_STORAGE_KEY, FLOW_STEP_STORAGE_KEY } from './shared';
import { TeamStep } from './TeamStep';
import { ToolsStep } from './ToolsStep';

function StepFallback() {
  return (
    <div
      role="status"
      aria-label="Loading setup"
      class="flex justify-center py-10"
    >
      <LogoIcon class="size-6 animate-pulse text-ink/30" />
    </div>
  );
}

export function OnboardingFlow() {
  return (
    <Suspense fallback={<StepFallback />}>
      <FlowContent />
    </Suspense>
  );
}

/** Real authenticated setup. Provider callbacks resume the same per-user step. */
function FlowContent() {
  const navigate = useNavigate();
  const isAuthenticated = useIsAuthenticated();
  const userInfoQuery = useUserInfoQuery();
  const info = () => (userInfoQuery.isSuccess ? userInfoQuery.data : undefined);
  const needsOnboarding = () =>
    info()?.authenticated === true && info()?.tutorialComplete === false;
  const onboardingQuery = useOnboardingQuery({ enabled: needsOnboarding });
  useImportQuery({ enabled: needsOnboarding });
  const linksQuery = useEmailLinksQuery(needsOnboarding);
  const links = () => (linksQuery.isSuccess ? linksQuery.data.links : []);
  const accounts = () =>
    resolveGoogleAccounts(links(), info()?.id, info()?.email);
  const inviteOfferQuery = useGtmInviteOfferQuery({ enabled: needsOnboarding });
  const inviteOffer = () =>
    inviteOfferQuery.isSuccess ? inviteOfferQuery.data : null;
  const serversQuery = useMcpServersQuery({ neverSuspend: true });
  const pipedreamQuery = usePipedreamConnectionsQuery({ neverSuspend: true });
  const analytics = useAnalytics();
  const connectorConfig = useFeatureFlag(ONBOARDING_CONNECTORS_FEATURE_FLAG);
  const connectorNames = () => {
    const config = connectorConfig();
    return resolveOnboardingConnectorNames(config.enabled, config.payload);
  };
  const [selected, setSelected] = createSignal<OnboardingIntegration[]>([]);
  const [activeKey, setActiveKey] = createSignal('welcome');
  const [restored, setRestored] = createSignal(false);
  const [planChoice, setPlanChoice] = createSignal<{
    plan: 'free' | 'premium';
    skipped: boolean;
  }>({ plan: 'free', skipped: false });
  const keys = () => onboardingStepKeys(selected().map((item) => item.id));
  const resolvedKey = () => resolveSetupStep(keys(), activeKey());
  // Old saved steps and provider callbacks cannot bypass the work-email gate.
  const currentKey = () =>
    keys().indexOf(resolvedKey()) > keys().indexOf('email') &&
    !accounts().workConnected
      ? 'email'
      : resolvedKey();
  const stepIndex = () => keys().indexOf(currentKey());
  const currentIntegration = () =>
    selected().find((item) => currentKey() === `connect-${item.id}`);
  let restoredUser: string | undefined;

  createEffect(() => {
    const uid = info()?.id;
    if (!uid || uid === restoredUser) return;
    restoredUser = uid;
    batch(() => {
      setPlanChoice({ plan: 'free', skipped: false });
      setSelected(readOnboardingIntegrations(sessionStorage, uid));
      const handoff = consumeOnboardingHandoff(sessionStorage);
      if (handoff) {
        setActiveKey('email');
        if (handoff.next) {
          try {
            sessionStorage.setItem(FLOW_NEXT_STORAGE_KEY, handoff.next);
          } catch {
            /* Storage is optional. */
          }
        }
      } else {
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(FLOW_STEP_STORAGE_KEY) ?? 'null'
          );
          if (saved?.user === uid && typeof saved.step === 'string') {
            setActiveKey(saved.step);
            if (
              (saved.planChoice?.plan === 'free' ||
                saved.planChoice?.plan === 'premium') &&
              typeof saved.planChoice.skipped === 'boolean'
            )
              setPlanChoice(saved.planChoice);
          } else {
            sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
            sessionStorage.removeItem(FLOW_NEXT_STORAGE_KEY);
            setActiveKey('welcome');
          }
        } catch {
          setActiveKey('welcome');
        }
      }
      setRestored(true);
    });
  });

  // Persist the requested key, not a temporary gate while links are loading.
  createEffect(() => {
    if (!restored() || !info()?.id) return;
    try {
      sessionStorage.setItem(
        FLOW_STEP_STORAGE_KEY,
        JSON.stringify({
          user: info()?.id,
          step: resolvedKey(),
          planChoice: planChoice(),
        })
      );
    } catch {
      /* Setup remains usable when storage is unavailable. */
    }
  });

  const changeSelection = (items: OnboardingIntegration[]) => {
    setSelected(items);
    const uid = info()?.id;
    if (uid) writeOnboardingIntegrations(sessionStorage, uid, items);
  };
  const advance = (state: 'completed' | 'skipped') => {
    analytics.track('onboarding_v4_step', {
      step: currentKey(),
      index: stepIndex(),
      state,
    });
    setActiveKey(keys()[Math.min(stepIndex() + 1, keys().length - 1)]);
  };
  let startedTracked = false;
  createEffect(() => {
    if (
      startedTracked ||
      !needsOnboarding() ||
      !restored() ||
      !linksQuery.isSuccess
    )
      return;
    startedTracked = true;
    analytics.track('onboarding_v4_started', {
      signup_method: accounts().workConnected ? 'google' : 'email_code',
      entry_step: currentKey(),
    });
  });
  createEffect(() => {
    if (!restored() || !needsOnboarding()) return;
    analytics.track('onboarding_v4_step', {
      step: currentKey(),
      index: stepIndex(),
      state: 'viewed',
    });
  });

  const finish = createFlowFinish({
    completionRollup: () => ({
      emails_connected: links().length,
      connectors_connected:
        pipedreamQuery.isSuccess && pipedreamQuery.data.length
          ? pipedreamQuery.data.map((connection) =>
              connection.server_name.toLowerCase()
            )
          : serversQuery.isSuccess
            ? serversQuery.data
                .filter((server) => server.authenticated)
                .map((server) => server.server_name.toLowerCase())
            : [],
    }),
  });
  const completeTutorial = useCompleteTutorialMutation();
  const [healing, setHealing] = createSignal(false);
  const healTutorial = async () => {
    if (healing()) return;
    setHealing(true);
    try {
      await completeTutorial.mutateAsync();
      await queryClient.refetchQueries({
        queryKey: authKeys.userInfo.queryKey,
      });
    } catch {
      /* Stay in setup; a later visit can retry the incomplete finish. */
    }
  };
  createEffect(() => {
    const user = info();
    if (isAuthenticated() === false || user?.authenticated === false) {
      navigate(`/login${window.location.search}`, { replace: true });
      return;
    }
    if (finish.finishing() || user?.authenticated !== true) return;
    if (user.tutorialComplete !== false) {
      navigate(finish.afterTarget(), { replace: true });
      return;
    }
    if (
      onboardingQuery.isSuccess &&
      onboardingQuery.data.row.status === 'completed'
    )
      void healTutorial();
  });

  let content!: HTMLDivElement;
  let disposeHandoff: (() => void) | undefined;
  onCleanup(() => disposeHandoff?.());
  const advanceAccount = (state: 'completed' | 'skipped') => {
    disposeHandoff?.();
    disposeHandoff = transitionOnboardingStep(content, () => advance(state));
  };
  const choosePlan = (plan: 'free' | 'premium', skipped = false) => {
    setPlanChoice({ plan, skipped });
    advanceAccount(skipped ? 'skipped' : 'completed');
  };
  const finishTeam = () => {
    if (finish.finishing()) return;
    analytics.track('onboarding_v4_step', {
      step: 'team',
      index: stepIndex(),
      state: 'completed',
    });
    const choice = planChoice();
    const paid =
      choice.plan === 'premium' ||
      info()?.licenseStatus === 'active' ||
      info()?.licenseStatus === 'trialing';
    if (paid) void finish.finishPremium();
    else void finish.finishFree(choice.skipped);
  };
  const advanceStory = (features?: string[]) => {
    if (features) {
      analytics.track('onboarding_v4_features_selected', {
        features,
        feature_count: features.length,
        source: 'app_onboarding',
      });
    }
    disposeHandoff?.();
    if (currentKey() === 'welcome')
      disposeHandoff = animateSecurityHandoff(
        content,
        () => advance('completed'),
        'intro'
      );
    else if (currentKey() === 'vision')
      disposeHandoff = animateSecurityHandoff(
        content,
        () => advance('completed'),
        'features'
      );
    else if (currentKey() === 'security')
      disposeHandoff = animateSecurityHandoff(content, () =>
        advance('completed')
      );
    else advance('completed');
  };
  createEffect(
    on(
      currentKey,
      () => {
        queueMicrotask(() => {
          const scroller = content
            ?.closest('.onboarding-flow')
            ?.querySelector('[data-onboarding-scroll]');
          scroller?.scrollTo({ top: 0, behavior: 'instant' });
          content
            ?.querySelector<HTMLElement>('h1')
            ?.focus({ preventScroll: true });
        });
      },
      { defer: true }
    )
  );

  return (
    <OnboardingShell
      wide
      onBack={
        stepIndex() > 0 && !finish.finishing()
          ? () => {
              disposeHandoff?.();
              disposeHandoff = transitionOnboardingStep(content, () =>
                setActiveKey(keys()[Math.max(0, stepIndex() - 1)])
              );
            }
          : undefined
      }
      explainer={
        ['security', 'email', 'personal'].includes(currentKey()) ? (
          <OnboardingTrustDetails
            topic={currentKey() === 'security' ? 'security' : 'google'}
          />
        ) : undefined
      }
    >
      <Show when={restored()} fallback={<StepFallback />}>
        <div ref={content} class="flex flex-col gap-8">
          <Show
            when={
              stepIndex() > 0 &&
              currentKey() !== 'security' &&
              currentKey() !== 'email' &&
              currentKey() !== 'personal' &&
              currentKey() !== 'team' &&
              !finish.finishing()
            }
          >
            <button
              type="button"
              class="w-fit rounded-lg py-1 text-sm text-ink-extra-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
              onClick={() => setActiveKey(keys()[Math.max(0, stepIndex() - 1)])}
            >
              ← Back
            </button>
          </Show>
          <Suspense fallback={<StepFallback />}>
            <Switch>
              <Match when={isStoryStep(currentKey())}>
                <StoryStage
                  step={(() => {
                    const key = currentKey();
                    return isStoryStep(key) ? key : 'welcome';
                  })()}
                  onNext={advanceStory}
                  durationMs={650}
                >
                  <ToolsStep
                    connectorNames={connectorNames()}
                    selected={selected()}
                    onSelectionChange={changeSelection}
                    onContinue={() => advanceAccount('completed')}
                  />
                </StoryStage>
              </Match>
              <Match when={currentKey() === 'email'}>
                <EmailStep onContinue={() => advanceAccount('completed')} />
              </Match>
              <Match when={currentKey() === 'personal'}>
                <EmailStep
                  mode="personal"
                  onContinue={() => advanceAccount('completed')}
                  onSkip={() => advanceAccount('skipped')}
                />
              </Match>
              <Match when={currentIntegration()}>
                <Show when={currentIntegration()} keyed>
                  {(integration) => (
                    <ConnectorStep
                      integration={integration}
                      onContinue={() => advanceAccount('completed')}
                      onSkip={() => advanceAccount('skipped')}
                    />
                  )}
                </Show>
              </Match>
              <Match when={currentKey() === 'team'}>
                <TeamSetup>
                  <fieldset disabled={finish.finishing()} class="min-w-0">
                    <TeamStep onContinue={finishTeam} />
                  </fieldset>
                  <Show when={finish.finishing()}>
                    <p
                      role="status"
                      class="mt-4 text-center text-sm text-ink-muted"
                    >
                      Setting up your workspace…
                    </p>
                  </Show>
                </TeamSetup>
              </Match>
              <Match when={currentKey() === 'plan'}>
                <header class="flex flex-col gap-4 text-center">
                  <h1
                    tabindex="-1"
                    class="font-[Roboto_Slab_Variable] text-3xl font-[315] leading-tight tracking-tight sm:text-[42px]"
                  >
                    {inviteOffer()
                      ? 'Your first month is on us'
                      : 'Make yourself at home.'}
                  </h1>
                  <p class="text-base leading-7 text-ink-muted">
                    {inviteOffer()
                      ? 'Your invite includes Macro Premium free for the first month. You can change plans anytime.'
                      : 'Start free, or choose Premium. You can change your plan anytime.'}
                  </p>
                </header>
                <PlanStep
                  finishing={finish.finishing()}
                  inviteOffer={inviteOffer()}
                  onFree={(skipped) => choosePlan('free', skipped)}
                  onStartCheckout={(tier) =>
                    void finish.startPremiumCheckout(tier)
                  }
                  onPremiumPaid={() => choosePlan('premium')}
                />
              </Match>
            </Switch>
          </Suspense>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={keys().length}
            aria-valuenow={stepIndex() + 1}
            class="flex flex-wrap justify-center gap-1.5 pb-3"
          >
            <For each={keys()}>
              {(key, index) => (
                <span
                  class="size-1.5 rounded-full"
                  classList={{
                    'bg-ink': currentKey() === key,
                    'bg-ink/40': index() < stepIndex(),
                    'bg-ink/15': index() > stepIndex(),
                  }}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </OnboardingShell>
  );
}
