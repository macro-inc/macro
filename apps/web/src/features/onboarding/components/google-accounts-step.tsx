import GoogleIcon from '@icon/macro-google.svg';
import MicrosoftIcon from '@icon/microsoft-color.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import HandIcon from '@icon/system/regular/hand-palm.svg';
import LockIcon from '@icon/system/regular/lock-key.svg';
import ShieldIcon from '@icon/system/regular/shield-check.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { onCleanup, onMount, Show } from 'solid-js';
import { ContinueButton } from './controls';
import { animateOnboardingStep } from './motion/step-transition';

export interface GoogleAccountsStepProps {
  mode?: 'work' | 'personal';
  accountEmail?: string;
  workConnected?: boolean;
  workNeedsReconnect?: boolean;
  personalEmail?: string;
  connecting?: 'work' | 'personal';
  /** The pending connection is the Microsoft one, not Google's. */
  microsoftConnecting?: boolean;
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  onRetry?: () => void;
  onConnectWork: () => void;
  onConnectPersonal: () => void;
  /** Sign-up offers Microsoft beside Google; the signed-in flow does not. */
  onConnectMicrosoft?: () => void;
  onContinue?: () => void;
  onSkip?: () => void;
}

/** One decision per screen, with the reason for access explained before consent. */
export function GoogleAccountsStep(props: GoogleAccountsStepProps) {
  let root!: HTMLDivElement;
  onMount(() => {
    if (root.closest('[data-security-handoff]')) return;
    const animation = animateOnboardingStep(root, 'in');
    onCleanup(() => animation?.cancel());
  });
  const personal = () => props.mode === 'personal';
  const connected = () =>
    personal() ? !!props.personalEmail : !!props.workConnected;
  const blocked = () =>
    !!props.disabled || !!props.loading || !!props.connecting;
  const withMicrosoft = () => !personal() && !!props.onConnectMicrosoft;
  const googleConnecting = () =>
    !!props.connecting && !props.microsoftConnecting;
  const googleLabel = () => {
    if (props.loading) return 'Checking connection…';
    if (googleConnecting()) return 'Opening Google…';
    if (withMicrosoft()) return 'Continue with Google';
    if (personal()) return 'Connect personal email';
    if (props.workNeedsReconnect) return 'Reconnect work email';
    return 'Connect work email';
  };
  return (
    <div
      ref={root}
      class="mx-auto flex w-full max-w-lg flex-col items-center py-2 text-center sm:py-4"
    >
      <header class="flex w-full flex-col items-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(22px,6.6vw,30px)] font-[315] leading-[1.2] tracking-[-.025em] [text-wrap:balance] sm:text-[36px]"
        >
          {personal() ? 'Add your personal' : 'Connect your work'} <br />
          {withMicrosoft()
            ? 'email and calendar.'
            : 'Google email and calendar.'}
        </h1>
        <p class="mt-7 max-w-[440px] font-[Inter_Variable] text-sm font-normal leading-6 text-ink-muted sm:text-[15px] [text-wrap:balance]">
          {withMicrosoft() ? (
            // Line 2 stays 60–80% of line 1; the break hides where line 1 can't fit.
            <>
              Connect your Google or Microsoft account
              <br class="max-[359px]:hidden" /> to bring email/calendar to
              Macro.
            </>
          ) : personal() ? (
            'Add a personal account for email and calendar in Macro. This is optional; your Macro sign-in stays the same. Agents ask for approval before sending email, and you can disconnect anytime.'
          ) : (
            'Connect through Google to read, send, and organize email and manage your calendars in Macro. Agents ask for your approval before sending email. Your password stays with Google, and you can disconnect anytime.'
          )}
        </p>
      </header>

      <Show when={props.error}>
        <p role="alert" class="mt-5 max-w-md text-sm leading-6 text-ink-muted">
          {props.error}{' '}
          <Show when={props.onRetry}>
            <button
              type="button"
              onClick={props.onRetry}
              class="rounded-sm text-ink underline underline-offset-4"
            >
              Try again
            </button>
          </Show>
        </p>
      </Show>

      <div class="mt-7 flex w-full max-w-xs flex-col items-center gap-3">
        <Show
          when={connected()}
          fallback={
            <button
              type="button"
              disabled={blocked()}
              onClick={() =>
                personal() ? props.onConnectPersonal() : props.onConnectWork()
              }
              class="flex min-h-14 w-full items-center justify-center gap-3 rounded-full border border-transparent bg-ink px-6 py-4 text-base font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-40"
            >
              <Show
                when={googleConnecting() || props.loading}
                fallback={
                  <GoogleIcon
                    viewBox="0 0 24 24"
                    class="size-5 shrink-0"
                    fill="currentColor"
                    stroke="none"
                    aria-hidden="true"
                  />
                }
              >
                <SpinnerIcon class="size-5 animate-spin" />
              </Show>
              {googleLabel()}
            </button>
          }
        >
          <p
            role="status"
            class="flex max-w-full items-center gap-2 text-sm leading-6 text-ink-muted [overflow-wrap:anywhere]"
          >
            <CheckIcon class="size-4 shrink-0 text-ink" />
            {personal() ? props.personalEmail : 'Work email connected'}
          </p>
          <Show when={props.onContinue}>
            <ContinueButton
              label={personal() ? 'Choose integrations' : 'Continue'}
              disabled={blocked()}
              onClick={() => props.onContinue?.()}
            />
          </Show>
        </Show>
        <Show when={!connected() && withMicrosoft()}>
          <button
            type="button"
            disabled={blocked()}
            onClick={() => props.onConnectMicrosoft?.()}
            class="flex min-h-14 w-full items-center justify-center gap-3 rounded-full border border-edge bg-surface px-6 py-4 text-base font-medium text-ink transition-colors hover:bg-ink/5 dark-mode:border-[#ffffff14] dark-mode:bg-[oklch(0.17_0.002_250)] dark-mode:shadow-[inset_1px_1px_0_#ffffff12,0_10px_40px_-8px_#0004] dark-mode:hover:bg-[oklch(0.2_0.002_250)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-40"
          >
            <Show
              when={props.microsoftConnecting}
              fallback={
                <MicrosoftIcon
                  class="size-[18px] shrink-0"
                  aria-hidden="true"
                />
              }
            >
              <SpinnerIcon class="size-5 animate-spin" />
            </Show>
            {props.microsoftConnecting
              ? 'Opening Microsoft…'
              : 'Continue with Microsoft'}
          </button>
        </Show>
        <Show when={!connected() && props.onSkip}>
          <button
            type="button"
            disabled={!!props.connecting}
            onClick={props.onSkip}
            class="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40"
          >
            Skip for now
          </button>
        </Show>
      </div>

      <Show when={!personal() && props.accountEmail}>
        <p class="mt-3 max-w-sm text-xs leading-5 text-ink-extra-muted [overflow-wrap:anywhere]">
          {props.accountEmail}
        </p>
      </Show>

      <section
        aria-label="Privacy assurances"
        class="mt-9 grid w-full grid-cols-1 gap-6 border-t border-edge-muted pt-6 min-[360px]:grid-cols-3 min-[360px]:gap-3 sm:gap-6"
      >
        <div data-privacy-item class="flex min-w-0 flex-col items-center">
          <LockIcon class="size-5 text-ink-muted" aria-hidden="true" />
          <h2 class="mt-3 text-xs font-medium leading-5 text-ink">
            Zero retention
          </h2>
          <p class="mt-1 text-[11px] leading-[1.6] text-ink-extra-muted sm:text-xs">
            Agreements with
            <br />
            OpenAI &amp; Anthropic
          </p>
        </div>
        <div data-privacy-item class="flex min-w-0 flex-col items-center">
          <ShieldIcon class="size-5 text-ink-muted" aria-hidden="true" />
          <h2 class="mt-3 text-xs font-medium leading-5 text-ink">
            Audited security
          </h2>
          <p class="mt-1 text-[11px] leading-[1.6] text-ink-extra-muted sm:text-xs">
            SOC 2 · ISO 27001
            <br />
            CASA Tier 2
          </p>
        </div>
        <div data-privacy-item class="flex min-w-0 flex-col items-center">
          <HandIcon class="size-5 text-ink-muted" aria-hidden="true" />
          <h2 class="mt-3 text-xs font-medium leading-5 text-ink">
            Never sold
          </h2>
          <p class="mt-1 text-[11px] leading-[1.6] text-ink-extra-muted sm:text-xs">
            No generalized
            <br />
            AI model training.
          </p>
        </div>
      </section>
    </div>
  );
}
