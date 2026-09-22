import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { PageVignette } from '../../marketing/components/PageVignette';
import { SiteHeader } from '../../marketing/components/SiteHeader';
import { NoiseBackground } from '../flow/shared';

export function OnboardingShell(props: {
  wide?: boolean;
  children: JSX.Element;
  overlay?: JSX.Element;
  below?: JSX.Element;
}) {
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
      }}
    >
      <style>{
        /*css*/ `
        @keyframes obf-card-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .obf-card { animation: obf-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

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
      <SiteHeader />

      {/* Keep long connector catalogs and summaries inside the fixed frame. */}
      <div class="relative z-10 size-full overflow-x-hidden overflow-y-auto overscroll-contain">
        <div class="flex min-h-full items-center justify-center px-6 pb-10 pt-24">
          <div
            class={cn(
              'w-full obf-card transition-[max-width] duration-300 md:[&:has(.ob-welcome)]:max-w-[720px]',
              props.wide ? 'sm:max-w-xl' : 'sm:max-w-lg'
            )}
          >
            {props.children}
          </div>
        </div>
        {props.below}
      </div>
      <PageVignette />
      {props.overlay}
    </div>
  );
}
