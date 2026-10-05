import { type JSX, onCleanup, Show } from 'solid-js';
import { GoogleAccountsStep } from '../components/google-accounts-step';
import {
  animateStepChange,
  focusStepHeading,
} from '../components/motion/step-change';
import { OnboardingShell } from '../components/onboarding-shell';
import { OnboardingTrustDetails } from '../components/trust-details';
import {
  nextSignupStep,
  previousSignupStep,
  type SignupStep,
} from '../core/signup-draft';
import { createSignupJourney } from '../primitives/signup-journey';
import { StoryStageView } from './story-stage-view';

/** Public opening slides. Authentication happens only at the work-email step. */
export function SignupJourneyView(props: {
  /** Starts Google sign-up; on web the page navigates away. */
  onGoogle: () => Promise<void>;
  onBackFromEmail: () => void;
  /** The host's email sign-up form, shown in place of Google when chosen. */
  emailForm?: JSX.Element;
  showingEmail: boolean;
}) {
  const journey = createSignupJourney({ showingEmail: props.showingEmail });
  let content!: HTMLDivElement;
  let stopMotion: (() => void) | undefined;
  onCleanup(() => stopMotion?.());

  const goTo = (next: SignupStep | undefined) => {
    const current = journey.step();
    if (!next || next === current) return;
    stopMotion?.();
    stopMotion = animateStepChange(content, current, next, () => {
      journey.commit(next);
      queueMicrotask(() => focusStepHeading(content));
    });
  };
  const storyStep = () => {
    const step = journey.step();
    return step === 'work' ? undefined : step;
  };

  return (
    <OnboardingShell
      wide
      onBack={
        journey.step() === 'welcome'
          ? undefined
          : () => {
              if (props.showingEmail) props.onBackFromEmail();
              else goTo(previousSignupStep(journey.step()));
            }
      }
      explainer={
        journey.step() === 'security' || journey.step() === 'work' ? (
          <OnboardingTrustDetails
            topic={journey.step() === 'security' ? 'security' : 'google'}
          />
        ) : undefined
      }
    >
      <div ref={content} class="flex flex-col gap-8">
        <Show
          when={journey.step() === 'work'}
          fallback={
            <StoryStageView
              step={storyStep() ?? 'security'}
              onNext={() => goTo(nextSignupStep(journey.step()))}
              onWorkspaceContinue={(color) => {
                journey.setAccent(color);
                goTo('vision');
              }}
            />
          }
        >
          <Show
            when={props.showingEmail}
            fallback={
              <GoogleAccountsStep
                mode="work"
                connecting={journey.connecting() ? 'work' : undefined}
                error={journey.error()}
                onConnectWork={() => void journey.connectGoogle(props.onGoogle)}
                onConnectPersonal={() => {}}
              />
            }
          >
            <div class="mx-auto flex w-full max-w-sm flex-col gap-8">
              <h1
                tabindex="-1"
                class="text-center font-[Roboto_Slab_Variable] text-3xl font-[315] leading-tight tracking-tight"
              >
                Sign up with your work email.
              </h1>
              {props.emailForm}
            </div>
          </Show>
          <p class="mx-auto max-w-xs text-center text-xs leading-5 text-ink-extra-muted">
            Your work email becomes your Macro sign-in. By continuing, you agree
            to our{' '}
            <a href="/terms" class="underline underline-offset-2">
              terms
            </a>{' '}
            and{' '}
            <a href="/privacy" class="underline underline-offset-2">
              privacy policy
            </a>
            .
          </p>
        </Show>
      </div>
    </OnboardingShell>
  );
}
