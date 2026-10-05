import LogoIcon from '@icon/macro-logo.svg';
import { createEffect, Match, onCleanup, Switch } from 'solid-js';
import {
  animateStepChange,
  focusStepHeading,
} from '../components/motion/step-change';
import { OnboardingShell } from '../components/onboarding-shell';
import { PlanComparison } from '../components/plan-comparison';
import { OnboardingTrustDetails } from '../components/trust-details';
import { useOnboardingContext } from '../context/onboarding-context';
import type { CheckoutReturn } from '../core/checkout';
import {
  isStoryStep,
  type OnboardingStep,
  previousOnboardingStep,
  type StepOutcome,
} from '../core/steps';
import { createFlowFinish } from '../primitives/flow-finish';
import { createOnboardingFlow } from '../primitives/onboarding-flow';
import { EmailStep } from './email-step';
import { PlanStep } from './plan-step';
import { StoryStageView } from './story-stage-view';
import { TeamStep } from './team-step';
import { ToolsStep } from './tools-step';

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

/** The signed-in onboarding steps, from the workspace slides to the trial offer. */
export function OnboardingFlowView(props: {
  /** A deep link to land on after onboarding. */
  next: string | undefined;
  checkoutReturn: CheckoutReturn | undefined;
  onNavigate: (target: string) => void;
  /** Leaves the app for hosted checkout. */
  onRedirect: (url: string) => void;
  onSignedOut: () => void;
}) {
  const context = useOnboardingContext();
  const emailAccounts = context.createEmailAccounts();
  const connectedTools = context.createConnectedTools();
  const record = context.createOnboardingRecord();

  const finish = createFlowFinish(context, {
    next: () => props.next,
    onNavigate: props.onNavigate,
    onRedirect: props.onRedirect,
    completionRollup: () => {
      const accounts = emailAccounts.accounts();
      return {
        emails_connected: accounts.t === 'ready' ? accounts.value.length : 0,
        connectors_connected: [...(connectedTools() ?? [])],
      };
    },
  });
  const flow = createOnboardingFlow(context, {
    checkoutReturn: () => props.checkoutReturn,
    record,
    signupMethod: () => {
      const accounts = emailAccounts.accounts();
      if (accounts.t !== 'ready') return undefined;
      return accounts.value.length > 0 ? 'google' : 'email_code';
    },
    finishing: finish.finishing,
  });

  // Leaving is the host's decision; the flow only reports why.
  createEffect(() => {
    const status = flow.status();
    if (status.t === 'signed-out') props.onSignedOut();
    else if (status.t === 'complete') props.onNavigate(finish.afterTarget());
  });

  let content!: HTMLDivElement;
  let stopMotion: (() => void) | undefined;
  onCleanup(() => stopMotion?.());

  const step = () => {
    const status = flow.status();
    return status.t === 'active' ? status.step : undefined;
  };
  const storyStep = () => {
    const current = step();
    return current && isStoryStep(current) ? current : undefined;
  };

  const goTo = (next: OnboardingStep | undefined) => {
    const current = step();
    if (!next || !current || next === current) return;
    stopMotion?.();
    stopMotion = animateStepChange(content, current, next, () => {
      flow.commit(next);
      queueMicrotask(() => focusStepHeading(content));
    });
  };
  const advance = (outcome: StepOutcome = 'completed') =>
    goTo(flow.leave(outcome));
  const back = () => {
    const current = step();
    const previous = current && previousOnboardingStep(current);
    return previous && !finish.finishing() ? () => goTo(previous) : undefined;
  };

  return (
    <OnboardingShell
      wide
      onBack={back()}
      explainerLabel={step() === 'plan' ? 'Continue as Guest' : undefined}
      explainer={
        step() === 'plan' ? (
          <PlanComparison
            disabled={finish.finishing()}
            onContinueGuest={() => void finish.finishFree()}
            onBackToPro={() => focusStepHeading(content, true)}
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
        <Switch fallback={<StepFallback />}>
          <Match when={storyStep()}>
            {(story) => (
              <StoryStageView
                step={story()}
                onNext={() => advance()}
                onWorkspaceContinue={(color) => {
                  const viewer = context.viewer();
                  if (viewer.t !== 'signed-in') return;
                  context.applyAccent(color, viewer.viewer.id);
                  advance();
                }}
              >
                <ToolsStep onContinue={() => advance()} />
              </StoryStageView>
            )}
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
              checkoutReturn={props.checkoutReturn}
              finishing={finish.finishing()}
              onStartCheckout={(tier) => void finish.startPremiumCheckout(tier)}
              onPremiumPaid={finish.finishPremium}
            />
          </Match>
        </Switch>
      </div>
    </OnboardingShell>
  );
}
