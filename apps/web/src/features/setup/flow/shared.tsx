import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Layer } from '@ui';
import { For, onCleanup, onMount } from 'solid-js';

/** Where the flow persists its current step, so full-page OAuth round-trips
 * (adding a Gmail inbox, Stripe checkout aborts) resume where they left. */
export const FLOW_STEP_STORAGE_KEY = 'onboarding-flow-step';

/** Where the flow persists its `?next` deep link — the inbox-link OAuth
 * callback returns to bare /onboarding, which would otherwise drop it. */
export const FLOW_NEXT_STORAGE_KEY = 'onboarding-flow-next';

export const isPlausibleEmail = (value: string) =>
  /^\S+@\S+\.\S+$/.test(value.trim());

/** The part after `@`, lowercased — `undefined` when it isn't an address. */
export function emailDomain(address: string | undefined): string | undefined {
  const at = address?.lastIndexOf('@') ?? -1;
  if (!address || at < 1 || at === address.length - 1) return undefined;
  return address.slice(at + 1).toLowerCase();
}

/** "macro.com" → "Macro": the domain root, capitalized. Whether a domain
 * deserves a team suggestion at all is judged server-side
 * (`OnboardingState.suggested_team_domain`) — no domain list lives here. */
export function deriveTeamName(domain: string): string {
  const root = domain.split('.')[0] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export function FormInput(props: {
  id: string;
  type?: string;
  placeholder?: string;
  value: string;
  autoFocus?: boolean;
  label?: string;
  invalid?: boolean;
  onInput: (value: string) => void;
}) {
  let inputEl: HTMLInputElement | undefined;
  onMount(() => {
    if (!props.autoFocus) return;
    // The Stepper's outin Transition mounts this JSX before attaching it to
    // the document, so poll until connected — cancelled on unmount, or a
    // node discarded before attaching would keep the rAF loop alive.
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    const focusWhenConnected = () => {
      if (cancelled || !inputEl) return;
      if (inputEl.isConnected) inputEl.focus({ preventScroll: true });
      else requestAnimationFrame(focusWhenConnected);
    };
    focusWhenConnected();
  });
  return (
    <input
      ref={(el) => (inputEl = el)}
      id={props.id}
      name={props.id}
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      type={props.type ?? 'text'}
      placeholder={props.placeholder}
      value={props.value}
      autocomplete={props.id}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      class="obf-input w-full px-4 py-3 rounded-2xl border border-edge bg-input text-sm text-ink placeholder:text-ink-placeholder focus:border-ink/40 focus:outline-none transition-colors"
    />
  );
}

/** A quiet inset frame, free of gradients. */
export function NoiseBackground() {
  return (
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-4 rounded-[32px] border border-ink/[0.04] sm:inset-6"
    />
  );
}

/** Bordered card listing what connecting a tool actually does. */
export function FeatureList(props: { features: string[] }) {
  return (
    <Layer depth={2}>
      <div class="rounded-xl border border-ink/[0.06] bg-surface">
        <For each={props.features}>
          {(feature) => (
            <div class="flex items-start gap-2.5 border-b border-edge-muted px-4 py-3 text-sm text-ink-muted last:border-b-0">
              <CheckIcon class="mt-0.5 size-3.5 shrink-0 text-accent" />
              <span class="leading-snug">{feature}</span>
            </div>
          )}
        </For>
      </div>
    </Layer>
  );
}

export function SkipButton(props: {
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="glass self-center rounded-full bg-surface px-4 py-2 text-xs text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-40"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label ?? 'Skip for now'}
    </button>
  );
}

export function ContinueButton(props: {
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div class="h-44 shrink-0">
      <div class="pointer-events-none fixed inset-x-0 bottom-[max(100px,env(safe-area-inset-bottom))] z-30 flex justify-center">
        <button
          type="button"
          aria-label={props.label ?? 'Continue'}
          title={props.label ?? 'Continue'}
          disabled={props.disabled}
          onClick={props.onClick}
          class="glass pointer-events-auto flex min-h-20 min-w-48 max-w-[calc(100vw-48px)] items-center justify-center gap-6 rounded-full bg-ink px-8 py-5 text-lg font-medium text-surface after:p-[2px] focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ink disabled:opacity-40"
          style={{
            '--glass-tint': 'var(--color-surface)',
            background:
              'linear-gradient(155deg, var(--color-ink) 35%, color-mix(in oklab, var(--color-ink) 72%, var(--color-surface)))',
            'box-shadow':
              'inset 0 2px 1px var(--color-ink), inset 0 -4px 3px color-mix(in oklab, var(--color-surface) 35%, transparent), 0 5px 0 color-mix(in oklab, var(--color-ink) 30%, var(--color-surface)), 0 10px 16px color-mix(in oklab, var(--color-surface) 80%, transparent)',
          }}
        >
          <span>{props.label ?? 'Continue'}</span>
          <ArrowRightIcon class="size-8 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
