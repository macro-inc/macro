import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { cn } from '@ui/utils/classname';
import { children, createMemo, createUniqueId, type JSX, Show } from 'solid-js';
import { NoiseBackground } from './controls';
import './onboarding.css';

export function OnboardingShell(props: {
  wide?: boolean;
  onBack?: () => void;
  children: JSX.Element;
  overlay?: JSX.Element;
  heroFooter?: JSX.Element;
  below?: JSX.Element;
  explainer?: JSX.Element;
  explainerLabel?: string;
}) {
  const detailsId = createUniqueId();
  const explainer = createMemo(() => props.explainer);
  const heroFooter = children(() => props.heroFooter);
  let details!: HTMLDivElement;
  return (
    <div
      class="onboarding-flow relative size-full overflow-hidden bg-surface font-sans text-ink"
      style={{
        '--color-surface': '#000',
        '--color-ink': '#fff',
        '--color-ink-muted': '#a8a8a8',
        '--color-ink-extra-muted': '#737373',
        '--color-edge': '#292929',
        '--color-edge-muted': '#1c1c1c',
        '--color-accent': 'var(--color-ink)',
        '--color-accent-contrast': '#000',
        '--color-accent-contrast-muted': '#292929',
        '--color-input': '#171717',
        '--color-ink-placeholder': '#737373',
        '--glass-tint': '#fff',
        '--glass-shade-color': '#000',
        '--glass-highlight-base': '6%',
        '--glass-rim-strong-base': '13.5%',
        '--glass-rim-soft-base': '9%',
        '--glass-rim-shade-base': '0%',
      }}
    >
      <style>{
        /*css*/ `
        @keyframes obf-card-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .onboarding-flow:not([data-landing]) .obf-card { animation: obf-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes ob-orbit-in { from { opacity: 0; transform: translate(-50%, -40%) scale(.8); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        .ob-orbit-tile { animation: ob-orbit-in 900ms cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .onboarding-flow *, .onboarding-flow *::before, .onboarding-flow *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
        /* Override browser autofill yellow with our surface/ink palette */
        .obf-input:-webkit-autofill,
        .obf-input:-webkit-autofill:hover,
        .obf-input:-webkit-autofill:focus,
        .obf-input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px var(--color-surface) inset;
          -webkit-text-fill-color: var(--color-ink);
          caret-color: var(--color-ink);
          transition: background-color 5000s ease-in-out 0s;
        }
      `
      }</style>

      <NoiseBackground />
      <header class="absolute left-6 top-5 z-50 sm:left-10">
        <Show when={props.onBack}>
          <button
            type="button"
            aria-label="Back to previous step"
            onClick={() => props.onBack?.()}
            class="grid size-[68px] -ml-2.5 place-items-center rounded-full text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-ink"
          >
            <ArrowLeftIcon class="size-7" aria-hidden="true" />
          </button>
        </Show>
      </header>

      {/* Keep long connector catalogs and summaries inside the fixed frame. */}
      <div
        data-onboarding-scroll
        role="main"
        class="relative z-10 size-full overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div
          data-onboarding-hero
          class={cn(
            'relative z-[3] flex min-h-full items-center justify-center px-6 pt-24',
            explainer() ? 'pb-32' : heroFooter() ? 'pb-24' : 'pb-10'
          )}
        >
          <div
            class={cn(
              'w-full obf-card transition-[max-width] duration-300 md:[&:has(.ob-welcome)]:max-w-[720px]',
              props.wide ? 'sm:max-w-xl' : 'sm:max-w-lg'
            )}
          >
            {props.children}
          </div>
          {heroFooter()}
          <Show when={explainer()}>
            <button
              type="button"
              aria-controls={detailsId}
              class="absolute bottom-[30px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-lg px-4 py-1 text-xs leading-5 text-ink-extra-muted transition-colors hover:text-ink-muted focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink-muted"
              onClick={() => {
                details
                  .querySelector<HTMLElement>('h2')
                  ?.focus({ preventScroll: true });
                details.scrollIntoView({
                  block: 'start',
                  behavior: window.matchMedia(
                    '(prefers-reduced-motion: reduce)'
                  ).matches
                    ? 'instant'
                    : 'smooth',
                });
              }}
            >
              {props.explainerLabel ?? 'Read more'}
              <ArrowDownIcon class="size-5" aria-hidden="true" />
            </button>
          </Show>
        </div>
        <Show when={explainer()}>
          <div ref={details} id={detailsId} data-onboarding-details>
            {explainer()}
          </div>
        </Show>
        {props.below}
      </div>
      {props.overlay}
    </div>
  );
}
