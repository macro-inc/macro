import { MacroMarkIcon } from '@app/features/onboarding/components/macro-mark-icon';
import { OnboardingShell } from '@app/features/onboarding/components/onboarding-shell';
import { displayName, sourceUrl } from '@core/constant/brand';
import { type JSX, Show } from 'solid-js';

/** The centered sign-in card, framed and styled like onboarding's slides. */
export function LoginCard(props: {
  /** The header yields to the on-screen keyboard on phones. */
  compact: boolean;
  /** The agent signup page names what it creates. */
  agentSignup?: boolean;
  children: JSX.Element;
}) {
  return (
    <OnboardingShell>
      <div class="mx-auto flex w-full max-w-sm flex-col items-center text-center">
        <Show when={!props.compact}>
          <div
            aria-hidden="true"
            class="flex size-16 items-center justify-center rounded-[18px] text-ink"
            style={{
              background:
                'var(--onboarding-intro-background, linear-gradient(145deg, #171717, #090909 65%))',
              'box-shadow':
                'var(--onboarding-intro-shadow, inset .5px .5px 1px #ffffff1c, inset -.5px -.5px 1px #0008, 0 1px 1px #131313, 0 4px 10px #0005)',
            }}
          >
            <MacroMarkIcon class="h-[22px] w-8" />
          </div>
          <h1
            tabindex="-1"
            class="mt-8 font-[Roboto_Slab_Variable] text-[30px] font-[315] leading-[1.2] tracking-[-.025em] outline-none [text-wrap:balance] sm:text-[36px]"
          >
            {props.agentSignup ? 'Sign up as an agent' : `Welcome to ${displayName}`}
          </h1>
          <p class="mt-4 font-[Inter_Variable] text-sm leading-6 text-ink-muted sm:text-[15px]">
            {props.agentSignup
              ? 'Use your own Google account or email address. You get an SDK token next.'
              : 'The open source workspace'}
          </p>
        </Show>
        <div
          class={props.compact ? 'w-full text-left' : 'mt-9 w-full text-left'}
        >
          {props.children}
        </div>
        <p class="mt-8 text-xs leading-5 text-ink-extra-muted [text-wrap:balance]">
          By continuing, you agree to our{' '}
          <a
            href="/terms"
            class="underline underline-offset-2 hover:text-ink-muted"
          >
            terms
          </a>{' '}
          and{' '}
          <a
            href="/privacy"
            class="underline underline-offset-2 hover:text-ink-muted"
          >
            privacy policy
          </a>
          .
        </p>
        <p class="mt-3 text-xs leading-5 text-ink-extra-muted [text-wrap:balance]">
          {displayName} is a modified version of{' '}
          <a
            href="https://github.com/macro-inc/macro"
            target="_blank"
            rel="noreferrer"
            class="underline underline-offset-2 hover:text-ink-muted"
          >
            macro-inc/macro
          </a>
          , modified 2026-11-12 under the existing license notices.{' '}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            class="underline underline-offset-2 hover:text-ink-muted"
          >
            Source
          </a>
          .
        </p>
      </div>
    </OnboardingShell>
  );
}
