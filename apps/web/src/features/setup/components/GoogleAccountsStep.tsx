import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-slab';
import GoogleIcon from '@icon/macro-google.svg';
import CheckIcon from '@phosphor/check.svg';
import HandIcon from '@phosphor/hand-palm.svg';
import LockIcon from '@phosphor/lock-key.svg';
import ShieldIcon from '@phosphor/shield-check.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { onCleanup, onMount, Show } from 'solid-js';
import { ContinueButton, elevatedButtonStyle } from '../flow/shared';
import { animateOnboardingStep } from '../primitives/animateOnboardingStep';

export interface GoogleAccountsStepProps {
  mode?: 'work' | 'personal';
  accountEmail?: string;
  workConnected?: boolean;
  workNeedsReconnect?: boolean;
  personalEmail?: string;
  connecting?: 'work' | 'personal';
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  onRetry?: () => void;
  onConnectWork: () => void;
  onConnectPersonal: () => void;
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
    !!props.disabled ||
    !!props.loading ||
    !!props.connecting ||
    (personal() && !props.workConnected);
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
          Google email and calendar.
        </h1>
        <p class="mt-7 max-w-[440px] font-[Inter_Variable] text-sm font-normal leading-6 text-ink-muted sm:text-[15px] [text-wrap:balance]">
          {personal()
            ? 'Keep your personal email and calendar alongside work. Agents ask for approval before sending email, and you can disconnect anytime.'
            : 'Connect through Google to read, send, and organize email and manage your calendars in Macro. Agents ask for your approval before sending email. Your password stays with Google, and you can disconnect anytime.'}
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
              class="glass flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-ink px-6 py-4 text-base font-medium text-surface after:p-[2px] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-40"
              style={elevatedButtonStyle}
            >
              <Show
                when={!!props.connecting || props.loading}
                fallback={<GoogleIcon class="size-5 shrink-0" />}
              >
                <SpinnerIcon class="size-5 animate-spin" />
              </Show>
              {props.loading
                ? 'Checking connection…'
                : props.connecting
                  ? 'Opening Google…'
                  : personal()
                    ? 'Connect personal email'
                    : props.workNeedsReconnect
                      ? 'Reconnect work email'
                      : 'Connect work email'}
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
        <Show when={personal() && !connected() && props.onSkip}>
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
            Yours to control.
            <br />
            No AI training.
          </p>
        </div>
      </section>
    </div>
  );
}
