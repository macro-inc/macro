import { useAnalytics } from '@app/lib/analytics/analytics-context';
import LogoIcon from '@icon/macro-logo.svg';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useEmailLinksQuery } from '@queries/email/link';
import { useImportQuery } from '@queries/import';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { useOnboardingQuery } from '@queries/onboarding';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { useNavigate, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { applyWorkspaceAccent } from '../applyWorkspaceAccent';
import { OnboardingShell } from '../components/OnboardingShell';
import { OnboardingTrustDetails } from '../components/OnboardingTrustDetails';
import { PlanComparison } from '../components/PlanComparison';
import { isStoryStep, StoryStage } from '../components/StoryStage';
import { clearSignupDraft, readSignupDraft } from '../core/signupDraft';
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  restoreOnboardingStep,
} from '../core/steps';
import { transitionOnboardingStep } from '../primitives/animateOnboardingStep';
import { animateSecurityHandoff } from '../primitives/animateSecurityHandoff';
import { ToolsStep } from '../views/ToolsStep';
import { createFlowFinish } from './createFlowFinish';
import { EmailStep } from './EmailStep';
import { PlanStep } from './PlanStep';
import { FLOW_NEXT_STORAGE_KEY, FLOW_STEP_STORAGE_KEY } from './shared';
import { TeamStep } from './TeamStep';

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

/** Real onboarding services beneath the marketing design, with OAuth-safe progress. */
export function OnboardingFlow() {
  return (
    <Suspense fallback={<StepFallback />}>
      <FlowContent />
    </Suspense>
  );
}

function FlowContent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const userInfo = useUserInfoQuery();
  const info = () => (userInfo.isSuccess ? userInfo.data : undefined);
  const needsOnboarding = () =>
    info()?.authenticated === true && info()?.tutorialComplete === false;
  const onboarding = useOnboardingQuery({ enabled: needsOnboarding });
  useImportQuery({ enabled: needsOnboarding });
  const links = useEmailLinksQuery();
  const servers = useMcpServersQuery({ neverSuspend: true });
  const connections = usePipedreamConnectionsQuery({ neverSuspend: true });
  const analytics = useAnalytics();
  const [step, setStep] = createSignal<OnboardingStep>('welcome');
  const index = () => ONBOARDING_STEPS.indexOf(step());
  const [restored, setRestored] = createSignal(false);
  let content!: HTMLDivElement;
  let stopMotion: (() => void) | undefined;
  onCleanup(() => stopMotion?.());

  createEffect(() => {
    const user = info()?.userId;
    if (restored() || !user) return;
    let savedStep: string | undefined;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(FLOW_STEP_STORAGE_KEY) ?? 'null'
      );
      if (saved?.user === user) savedStep = saved.step;
      else if (saved) {
        sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
        sessionStorage.removeItem(FLOW_NEXT_STORAGE_KEY);
      }
    } catch {
      sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
    }
    const signup = readSignupDraft();
    const initial = restoreOnboardingStep(
      signup?.authenticating ? 'work' : savedStep,
      params.subscriptionSuccess === 'true' ||
        params.subscriptionCancel === 'true'
    );
    setStep(initial);
    sessionStorage.setItem(
      FLOW_STEP_STORAGE_KEY,
      JSON.stringify({ user, step: initial })
    );
    if (signup?.authenticating && signup.accent) {
      applyWorkspaceAccent(signup.accent, user);
    }
    clearSignupDraft();
    setRestored(true);
  });

  let started = false;
  createEffect(() => {
    if (!restored() || !needsOnboarding() || started || !links.isSuccess)
      return;
    started = true;
    analytics.track('onboarding_v4_started', {
      signup_method: links.data.links.length ? 'google' : 'email_code',
      entry_step: step(),
    });
  });
  createEffect(() => {
    if (restored() && needsOnboarding())
      analytics.track('onboarding_v4_step', {
        step: step(),
        index: index(),
        state: 'viewed',
      });
  });

  const goTo = (next: OnboardingStep) => {
    if (next === step()) return;
    stopMotion?.();
    const previous = step();
    const commit = () => {
      setStep(next);
      sessionStorage.setItem(
        FLOW_STEP_STORAGE_KEY,
        JSON.stringify({ user: info()?.userId, step: next })
      );
      queueMicrotask(() => {
        content?.closest('[data-onboarding-scroll]')?.scrollTo({ top: 0 });
        content?.querySelector('h1')?.focus({ preventScroll: true });
      });
    };
    if (previous === 'welcome' && next === 'vision')
      stopMotion = animateSecurityHandoff(content, commit, 'intro');
    else if (previous === 'vision' && next === 'security')
      stopMotion = animateSecurityHandoff(content, commit, 'features');
    else if (previous === 'security' && next === 'work')
      stopMotion = animateSecurityHandoff(content, commit);
    else stopMotion = transitionOnboardingStep(content, commit);
  };
  const advance = (state: 'completed' | 'skipped' = 'completed') => {
    analytics.track('onboarding_v4_step', {
      step: step(),
      index: index(),
      state,
    });
    // Without a first account, offering a second account would be misleading.
    goTo(
      step() === 'work' && state === 'skipped'
        ? 'tools'
        : ONBOARDING_STEPS[Math.min(index() + 1, ONBOARDING_STEPS.length - 1)]
    );
  };
  const finish = createFlowFinish({
    completionRollup: () => ({
      emails_connected: links.isSuccess ? links.data.links.length : 0,
      connectors_connected: [
        ...new Set([
          ...(connections.data ?? []).map((connection) =>
            connection.server_name.toLowerCase()
          ),
          ...(servers.data ?? [])
            .filter((server) => server.authenticated)
            .map((server) => server.server_name.toLowerCase()),
        ]),
      ],
    }),
  });

  // Repair partially completed setup without sending the user into a redirect loop.
  const completeTutorial = useCompleteTutorialMutation();
  let healing = false;
  const heal = async () => {
    if (healing) return;
    healing = true;
    try {
      await completeTutorial.mutateAsync();
      await queryClient.refetchQueries({
        queryKey: authKeys.userInfo.queryKey,
      });
    } catch {
      healing = false;
    }
  };
  createEffect(() => {
    if (info()?.authenticated === false) {
      navigate('/login', { replace: true });
      return;
    }
    if (finish.finishing() || info()?.authenticated !== true) return;
    if (info()?.tutorialComplete !== false) {
      navigate(finish.afterTarget(), { replace: true });
      return;
    }
    if (onboarding.isSuccess && onboarding.data?.row.status === 'completed')
      void heal();
  });
  const backToTrial = () => {
    content.closest('[data-onboarding-scroll]')?.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
    content.querySelector('h1')?.focus({ preventScroll: true });
  };

  return (
    <OnboardingShell
      wide
      onBack={
        index() > 0 && !finish.finishing()
          ? () => goTo(ONBOARDING_STEPS[index() - 1])
          : undefined
      }
      explainerLabel={step() === 'plan' ? 'Continue as Guest' : undefined}
      explainer={
        step() === 'plan' ? (
          <PlanComparison
            disabled={finish.finishing()}
            onContinueGuest={() => void finish.finishFree()}
            onBackToPro={backToTrial}
          />
        ) : step() === 'security' ||
          step() === 'work' ||
          step() === 'personal' ? (
          <OnboardingTrustDetails
            topic={step() === 'security' ? 'security' : 'google'}
          />
        ) : undefined
      }
    >
      <div ref={content} class="flex flex-col gap-8">
        <Show when={restored()} fallback={<StepFallback />}>
          <Suspense fallback={<StepFallback />}>
            <Switch>
              <Match when={isStoryStep(step())}>
                <StoryStage
                  step={
                    isStoryStep(step())
                      ? (step() as 'welcome' | 'vision' | 'security' | 'tools')
                      : 'welcome'
                  }
                  onNext={() => advance()}
                  onWorkspaceContinue={(color) => {
                    const user = info()?.userId;
                    if (!user) return;
                    applyWorkspaceAccent(color, user);
                    advance();
                  }}
                >
                  <ToolsStep onContinue={() => advance()} />
                </StoryStage>
              </Match>
              <Match when={step() === 'work' || step() === 'personal'}>
                <EmailStep
                  mode={step() === 'personal' ? 'personal' : 'work'}
                  onContinue={() => advance()}
                  onSkip={() => advance('skipped')}
                />
              </Match>
              <Match when={step() === 'team'}>
                <TeamStep
                  onContinue={() => advance()}
                  onSkip={() => advance('skipped')}
                />
              </Match>
              <Match when={step() === 'plan'}>
                <PlanStep
                  finishing={finish.finishing()}
                  onStartCheckout={(tier) =>
                    void finish.startPremiumCheckout(tier)
                  }
                  onPremiumPaid={finish.finishPremium}
                />
              </Match>
            </Switch>
          </Suspense>
        </Show>
      </div>
    </OnboardingShell>
  );
}
