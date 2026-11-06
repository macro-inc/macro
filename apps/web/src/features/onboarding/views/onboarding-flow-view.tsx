import type { PaidPlanTier } from '@app/features/paywall/plans';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { BypassButton } from '../components/bypass-button';
import {
  animateStepChange,
  focusStepHeading,
} from '../components/motion/step-change';
import { OnboardingShell } from '../components/onboarding-shell';
import { StepFallback } from '../components/step-fallback';
import { OnboardingTrustDetails } from '../components/trust-details';
import { useOnboardingContext } from '../context/onboarding-context';
import type { CheckoutReturn } from '../core/checkout';
import { canBypassOnboarding } from '../core/staff';
import {
  isStoryStep,
  type OnboardingStep,
  previousOnboardingStep,
  type StepOutcome,
} from '../core/steps';
import { createFlowFinish } from '../primitives/flow-finish';
import { createOnboardingFlow } from '../primitives/onboarding-flow';
import { type DemoBookingSlot, DemoStep } from './demo-step';
import { EmailStep } from './email-step';
import { PlanComparisonView } from './plan-comparison-view';
import { type InviteOfferSlot, PlanStep } from './plan-step';
import { StoryStageView } from './story-stage-view';
import { TeamStep } from './team-step';
import { ToolsStep } from './tools-step';

/** The signed-in onboarding steps, from the workspace slides to the trial offer. */
export function OnboardingFlowView(props: {
  /** A deep link to land on after onboarding. */
  next: string | undefined;
  /** Raw `?step` from the entry link. Unknown values are ignored. */
  step?: string;
  checkoutReturn: CheckoutReturn | undefined;
  onNavigate: (target: string) => void;
  /** Leaves the app for hosted checkout. */
  onRedirect: (url: string) => void;
  onSignedOut: () => void;
  /** Shown instead of the trial to an account holding an invite promotion. */
  renderInviteOffer: InviteOfferSlot;
  /** The booking picker on the optional demo step. */
  renderDemoBooking: DemoBookingSlot;
}) {
  const context = useOnboardingContext();
  const emailAccounts = context.createEmailAccounts();
  // Read once for the completion rollup; only the tools step polls.
  const connectedTools = context.createConnectedTools({ poll: false });
  const record = context.createOnboardingRecord();
  const teamDirectory = context.createTeamDirectory();

  const finish = createFlowFinish(context, {
    next: () => props.next,
    onNavigate: props.onNavigate,
    onRedirect: props.onRedirect,
    completionRollup: () => {
      const accounts = emailAccounts.accounts();
      return {
        emails_connected: accounts.t === 'ready' ? accounts.value.length : 0,
        connectors_connected: [...connectedTools.connected()],
      };
    },
  });
  const flow = createOnboardingFlow(context, {
    checkoutReturn: () => props.checkoutReturn,
    requestedStep: () => props.step,
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
  // A paid team owner gets an optional demo booking before entering the app;
  // everyone else who paid finishes right away.
  const [paidTier, setPaidTier] = createSignal<PaidPlanTier>('premium');
  const ownsTeam = () => {
    const teams = teamDirectory.teams();
    return teams.t === 'ready' && teams.value.some((team) => team.owned);
  };
  const finishPaid = async (tier: PaidPlanTier = 'premium') => {
    if (!ownsTeam()) return finish.finishPremium(tier);
    setPaidTier(tier);
    goTo('demo');
  };
  const leaveDemo = (outcome: StepOutcome) => {
    if (finish.finishing()) return;
    flow.leave(outcome);
    const viewer = context.viewer();
    const licensed = viewer.t === 'signed-in' && viewer.viewer.licensed;
    fireAndForget(
      licensed ? finish.finishPremium(paidTier()) : finish.finishFree(),
      'onboarding'
    );
  };
  // Someone who already joined a team (invite link or domain) has nothing to
  // do on the team step, so the flow passes over it in both directions.
  const passesTeam = (target: OnboardingStep | undefined) => {
    const teams = teamDirectory.teams();
    return target === 'team' && teams.t === 'ready' && teams.value.length > 0;
  };
  const advance = (outcome: StepOutcome = 'completed') => {
    if (finish.finishing()) return;
    const next = flow.leave(outcome);
    const skipsTeam = passesTeam(next);
    if (skipsTeam)
      context.track('onboarding_v4_team', { action: 'already_on_team' });
    const viewer = context.viewer();
    if (
      (step() === 'team' || skipsTeam) &&
      viewer.t === 'signed-in' &&
      viewer.viewer.licensed
    ) {
      fireAndForget(finishPaid(), 'onboarding');
      return;
    }
    goTo(skipsTeam ? 'plan' : next);
  };
  const viewerEmail = () => {
    const viewer = context.viewer();
    return viewer.t === 'signed-in' ? viewer.viewer.email : undefined;
  };
  const showPlanOffer = () => {
    const viewer = context.viewer();
    return (
      step() === 'plan' &&
      props.checkoutReturn?.t !== 'success' &&
      viewer.t === 'signed-in' &&
      !viewer.viewer.licensed
    );
  };
  const back = () => {
    const current = step();
    // Payment is done by the demo step; there is nothing to go back to.
    if (current === 'demo') return undefined;
    const previous = current && previousOnboardingStep(current);
    const target = passesTeam(previous) ? 'tools' : previous;
    return target && !finish.finishing() ? () => goTo(target) : undefined;
  };

  return (
    <OnboardingShell
      wide
      onBack={back()}
      overlay={
        <Show when={canBypassOnboarding(viewerEmail()) && step()}>
          {(current) => (
            <BypassButton
              disabled={finish.finishing()}
              onBypass={() =>
                fireAndForget(finish.bypass(current()), 'onboarding')
              }
            />
          )}
        </Show>
      }
      explainerLabel={showPlanOffer() ? 'See more' : undefined}
      explainer={
        showPlanOffer() ? (
          <PlanComparisonView
            disabled={finish.finishing()}
            onContinueFree={() =>
              fireAndForget(finish.finishFree(), 'onboarding')
            }
            onBackToPro={() => focusStepHeading(content, true)}
            onStartMax={() =>
              fireAndForget(
                finish.startPremiumCheckout('max', 'standard'),
                'onboarding'
              )
            }
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
              finishing={finish.finishing()}
              onContinue={() => advance()}
              onSkip={() => advance('skipped')}
            />
          </Match>
          <Match when={step() === 'plan'}>
            <PlanStep
              checkoutReturn={props.checkoutReturn}
              finishing={finish.finishing()}
              onStartCheckout={(tier, terms) =>
                fireAndForget(
                  finish.startPremiumCheckout(tier, terms),
                  'onboarding'
                )
              }
              onContinueFree={() =>
                fireAndForget(finish.finishFree(), 'onboarding')
              }
              renderInviteOffer={props.renderInviteOffer}
              onPremiumPaid={finishPaid}
            />
          </Match>
          <Match when={step() === 'demo'}>
            <DemoStep
              finishing={finish.finishing()}
              renderBooking={props.renderDemoBooking}
              onContinue={() => leaveDemo('completed')}
              onSkip={() => leaveDemo('skipped')}
            />
          </Match>
        </Switch>
      </div>
    </OnboardingShell>
  );
}
