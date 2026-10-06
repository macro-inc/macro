import type { JSX } from 'solid-js';
import { ContinueButton } from '../flow/shared';

/** Presentation only: the host supplies payment UI and handles completion. */
export function PlanSelection(props: {
  onContinue: () => void;
  payment: JSX.Element;
  disabled?: boolean;
}) {
  return (
    <section class="mx-auto flex w-full max-w-lg flex-col py-2 sm:py-4">
      <header class="text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight text-balance outline-none"
        >
          Free Claude &amp; GPT for 30 days.
        </h1>
        <p class="mx-auto mt-6 max-w-[400px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          Every feature, every AI model and 1 TB of storage. Your first 30 days
          on us then $40/user month.
        </p>
      </header>

      <div class="glass-input mt-9 overflow-hidden rounded-2xl bg-ink/[0.065]">
        <div
          role="region"
          aria-label="Payment details"
          tabindex="0"
          class="max-h-[min(360px,50svh)] overflow-y-auto overscroll-contain p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
        >
          {props.payment}
        </div>
      </div>

      <ContinueButton
        label="Start 30 day trial"
        disabled={props.disabled}
        onClick={props.onContinue}
      />
      <p class="mx-auto mt-3 max-w-52 text-center text-xs leading-5 text-ink-extra-muted">
        <span class="block">$40/user/month, billed monthly</span>
        <span class="block">after the trial. Cancel anytime.</span>
      </p>
    </section>
  );
}
