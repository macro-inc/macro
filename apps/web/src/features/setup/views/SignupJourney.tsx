import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { GoogleAccountsStep } from '../components/GoogleAccountsStep';
import { OnboardingShell } from '../components/OnboardingShell';
import { OnboardingTrustDetails } from '../components/OnboardingTrustDetails';
import { StoryStage } from '../components/StoryStage';
import {
  readSignupDraft,
  SIGNUP_STEPS,
  type SignupStep,
  saveSignupDraft,
} from '../core/signupDraft';
import { transitionOnboardingStep } from '../primitives/animateOnboardingStep';
import { animateSecurityHandoff } from '../primitives/animateSecurityHandoff';

/** Public opening slides. Authentication happens only at the work-email step. */
export function SignupJourney(props: {
  onGoogle: () => Promise<void>;
  onBackFromEmail: () => void;
  emailForm?: JSX.Element;
  showingEmail: boolean;
}) {
  const draft = readSignupDraft();
  const [step, setStep] = createSignal<SignupStep>(
    props.showingEmail ? 'work' : (draft?.step ?? 'welcome')
  );
  const [accent, setAccent] = createSignal(draft?.accent);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let content!: HTMLDivElement;
  let stopMotion: (() => void) | undefined;
  onCleanup(() => stopMotion?.());

  const goTo = (next: SignupStep) => {
    stopMotion?.();
    const previous = step();
    const commit = () => {
      saveSignupDraft({ step: next, accent: accent() });
      setStep(next);
      queueMicrotask(() => {
        content.closest('[data-onboarding-scroll]')?.scrollTo({ top: 0 });
        content.querySelector('h1')?.focus({ preventScroll: true });
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
  const prepareAuth = () => {
    saveSignupDraft({ step: 'work', accent: accent(), authenticating: true });
  };
  const connect = async () => {
    if (connecting()) return;
    prepareAuth();
    setConnecting(true);
    setError();
    try {
      await props.onGoogle();
    } catch {
      setError("Couldn't open Google. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <OnboardingShell
      wide
      onBack={
        step() === 'welcome'
          ? undefined
          : () => {
              if (props.showingEmail) props.onBackFromEmail();
              else goTo(SIGNUP_STEPS[SIGNUP_STEPS.indexOf(step()) - 1]);
            }
      }
      explainer={
        step() === 'security' || step() === 'work' ? (
          <OnboardingTrustDetails
            topic={step() === 'security' ? 'security' : 'google'}
          />
        ) : undefined
      }
    >
      <div ref={content} class="flex flex-col gap-8">
        <Show
          when={step() === 'work'}
          fallback={
            <StoryStage
              step={
                step() === 'work'
                  ? 'security'
                  : (step() as 'welcome' | 'vision' | 'security')
              }
              onNext={() =>
                goTo(SIGNUP_STEPS[SIGNUP_STEPS.indexOf(step()) + 1])
              }
              onWorkspaceContinue={(color) => {
                setAccent(color);
                goTo('vision');
              }}
            >
              {undefined}
            </StoryStage>
          }
        >
          <Show
            when={props.showingEmail}
            fallback={
              <GoogleAccountsStep
                mode="work"
                connecting={connecting() ? 'work' : undefined}
                error={error()}
                onConnectWork={() => void connect()}
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
