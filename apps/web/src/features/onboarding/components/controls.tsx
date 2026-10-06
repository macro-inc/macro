import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { onCleanup, onMount } from 'solid-js';

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

export function SkipButton(props: {
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="self-center rounded-full border border-edge-muted bg-surface px-4 py-2 text-xs text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-40"
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
    <div class="mt-6 flex shrink-0 justify-center pb-3">
      <div class="flex justify-center">
        <button
          type="button"
          aria-label={props.label ?? 'Continue'}
          title={props.label ?? 'Continue'}
          disabled={props.disabled}
          onClick={props.onClick}
          class="flex min-h-14 min-w-44 max-w-full items-center justify-center gap-4 rounded-full bg-ink px-7 py-3.5 text-base font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ink disabled:opacity-40"
        >
          <span>{props.label ?? 'Continue'}</span>
          <ArrowRightIcon class="size-5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
