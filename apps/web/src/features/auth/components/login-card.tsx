import { NoiseBackground } from '@core/component/NoiseBackground';
import LogoIcon from '@icon/macro-logo.svg';
import { type JSX, Show } from 'solid-js';

/** The centered sign-in card: brand header, the active step, legal footer. */
export function LoginCard(props: {
  /** The header yields to the on-screen keyboard on phones. */
  compact: boolean;
  children: JSX.Element;
}) {
  return (
    <div class="flex items-center justify-center size-full overflow-hidden relative">
      <style>{
        /*css*/ `
          @keyframes ln-card-in {
            from { opacity: 0; transform: translateY(14px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0)    scale(1);     }
          }
          .ln-card { animation: ln-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

          /* Override browser autofill yellow with our surface/ink palette */
          .ln-input:-webkit-autofill,
          .ln-input:-webkit-autofill:hover,
          .ln-input:-webkit-autofill:focus,
          .ln-input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0 1000px var(--color-surface) inset;
            -webkit-text-fill-color: var(--color-ink);
            caret-color: var(--color-ink);
            transition: background-color 5000s ease-in-out 0s;
          }
        `
      }</style>

      <NoiseBackground />

      <div class="relative z-10 w-full max-w-sm sm:max-w-lg ln-card">
        <div class="px-4 sm:px-8 flex flex-col gap-12">
          <div class="flex flex-col gap-8">
            <Show when={!props.compact}>
              <div class="flex flex-col gap-1.5">
                <LogoIcon class="mb-2 size-9 text-accent" />
                <h1 class="font-semibold tracking-tight text-ink text-2xl">
                  Welcome to Macro
                </h1>
                <p class="text-sm text-ink-muted">The open source workspace</p>
              </div>
            </Show>
            {props.children}
          </div>

          <div class="text-center text-xs text-ink/50 wrap-break-word">
            By continuing, you agree to our{' '}
            <a
              class="text-link hover:text-link-hover visited:text-link-visited underline underline-offset-2 focus-visible:text-link-hover"
              href="/terms"
            >
              terms
            </a>{' '}
            and{' '}
            <a
              class="text-link hover:text-link-hover visited:text-link-visited underline underline-offset-2 focus-visible:text-link-hover"
              href="/privacy"
            >
              privacy policy
            </a>
            .
          </div>
        </div>
      </div>
    </div>
  );
}
