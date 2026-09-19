import ArrowRight from '@phosphor/arrow-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Button, Layer } from '@ui';
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
      type={props.type ?? 'text'}
      placeholder={props.placeholder}
      value={props.value}
      autocomplete={props.id}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      class="obf-input w-full px-4 py-3 rounded-lg border border-edge bg-surface text-sm text-ink placeholder:text-ink-placeholder focus:border-accent focus:outline-none transition-colors"
    />
  );
}

/**
 * Marketing-hero backdrop: an ink/surface wash plus a film-grain tile.
 * Both layers are pointer-transparent; page content must sit at z-10,
 * between the wash (z-0) and the grain (z-20).
 */
export function NoiseBackground() {
  return (
    <>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, var(--color-ink) 11%, var(--color-surface)) 0%, var(--color-surface) 75%)',
        }}
      />
      <div
        aria-hidden="true"
        style={`position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);width:100vw;pointer-events:none;z-index:20;opacity:0.05;mix-blend-mode:screen;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:300px 300px;-webkit-mask:linear-gradient(to bottom, transparent 0%, #000 12%, #000 100%);mask:linear-gradient(to bottom, transparent 0%, #000 12%, #000 100%)`}
      />
    </>
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
    <Button
      variant="ghost"
      size="sm"
      class="self-center text-ink-muted"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label ?? 'Skip for now'}
    </Button>
  );
}

export function ContinueButton(props: {
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="cta"
      size="xl"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label ?? 'Continue'}
      <ArrowRight class="size-5" />
    </Button>
  );
}
