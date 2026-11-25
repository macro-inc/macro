import { Match, Show, Switch } from 'solid-js';
import type { AppHandoffLink } from '../core/app-handoff';
import { MacroMarkIcon } from './macro-mark-icon';

/**
 * The last screen of a sign-up the native app started in the browser: one
 * link back into the app, which arrives signed in.
 */
export function AppHandoff(props: {
  link: AppHandoffLink;
  email: string | undefined;
  onOpen: () => void;
  onRetry: () => void;
  onSwitchAccount: () => void;
}) {
  return (
    <div class="mx-auto flex w-full max-w-lg flex-col items-center py-2 text-center">
      <div
        aria-hidden="true"
        class="flex size-16 items-center justify-center rounded-[18px] text-ink"
        style={{
          background:
            'var(--onboarding-intro-background, linear-gradient(145deg, #1c1c1c, #090909 65%))',
          'box-shadow':
            'var(--onboarding-intro-shadow, inset .5px .5px 1px #ffffff1c, inset -.5px -.5px 1px #0008, 0 1px 1px #131313, 0 4px 10px #0005)',
        }}
      >
        <MacroMarkIcon class="h-6 w-8 overflow-visible" />
      </div>
      <h1
        tabindex="-1"
        class="mt-8 font-[Roboto_Slab_Variable] text-[clamp(26px,7.4vw,30px)] font-[315] leading-[1.2] tracking-[-.025em] outline-none [text-wrap:balance]"
      >
        Your workspace is ready.
      </h1>
      <p class="mt-5 max-w-[340px] font-[Inter_Variable] text-sm leading-6 text-ink-muted [text-wrap:balance]">
        Open the Macro app to pick up where you left off.
        <Show when={props.email}>
          {(email) => (
            <>
              {' '}
              You're signed in as{' '}
              <span class="break-all text-ink">{email()}</span>.
            </>
          )}
        </Show>
      </p>
      <div class="mt-9 flex w-full max-w-xs flex-col items-stretch gap-3">
        <Switch>
          <Match
            when={(() => {
              const link = props.link;
              return link.t === 'ready' ? link : undefined;
            })()}
          >
            {(link) => (
              <a
                href={link().href}
                onClick={() => props.onOpen()}
                class="flex min-h-14 items-center justify-center rounded-full bg-ink px-6 py-4 text-base font-medium text-surface transition-opacity not-touch:hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
              >
                Open Macro
              </a>
            )}
          </Match>
          <Match when={props.link.t === 'minting'}>
            <span
              aria-disabled="true"
              class="flex min-h-14 items-center justify-center rounded-full bg-ink px-6 py-4 text-base font-medium text-surface opacity-50"
            >
              Open Macro
            </span>
          </Match>
          <Match when={props.link.t === 'failed'}>
            <p role="alert" class="text-sm leading-6 text-ink-muted">
              We couldn't get the app's sign-in ready.
            </p>
            <button
              type="button"
              onClick={() => props.onRetry()}
              class="flex min-h-14 items-center justify-center rounded-full bg-ink px-6 py-4 text-base font-medium text-surface transition-opacity not-touch:hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              Try again
            </button>
          </Match>
        </Switch>
      </div>
      <p class="mt-8 text-xs leading-5 text-ink-extra-muted">
        Not you?{' '}
        <button
          type="button"
          class="rounded-sm text-ink-muted underline underline-offset-2 transition-colors not-touch:hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink-muted"
          onClick={() => props.onSwitchAccount()}
        >
          Use a different account
        </button>
      </p>
    </div>
  );
}
