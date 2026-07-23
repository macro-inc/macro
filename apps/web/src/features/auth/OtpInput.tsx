import { cn } from '@ui';
import { createSignal, Index, onCleanup, onMount } from 'solid-js';

/**
 * Segmented one-time-code input: one visible box per digit, backed by a
 * single invisible input stretched over them — so focus, paste, backspace,
 * and `autocomplete="one-time-code"` all behave like a native field while
 * the boxes just render its value. The active box (where the next digit
 * lands) carries the focus ring.
 */
export function OtpInput(props: {
  length?: number;
  value: string;
  disabled?: boolean;
  onInput: (value: string) => void;
  onComplete?: (value: string) => void;
}) {
  const length = () => props.length ?? 6;
  let inputEl: HTMLInputElement | undefined;
  const [focused, setFocused] = createSignal(false);

  onMount(() => {
    // The Stepper's outin Transition resolves this step's JSX (firing
    // onMount) before attaching it to the document, so the input is still
    // detached here. Poll until it's connected, then focus — and stop on
    // unmount, or a node discarded before ever attaching would keep the
    // rAF loop (and itself) alive forever.
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

  const activeIndex = () => Math.min(props.value.length, length() - 1);

  // Sanitize in JS, not with maxLength: a native maxLength counts the RAW
  // pasted characters, so a code copied as "123 456" would be truncated to
  // "123 45" before the separator is stripped, silently dropping digits.
  // Writing the cleaned value back also keeps stray non-digits from
  // lingering in the (invisible) input.
  const handleInput = (el: HTMLInputElement) => {
    const value = el.value.replace(/\D/g, '').slice(0, length());
    if (el.value !== value) el.value = value;
    props.onInput(value);
    if (value.length === length()) props.onComplete?.(value);
  };

  return (
    <div class="relative">
      <input
        ref={(el) => {
          inputEl = el;
        }}
        type="text"
        inputMode="numeric"
        autocomplete="one-time-code"
        value={props.value}
        disabled={props.disabled}
        onInput={(e) => handleInput(e.currentTarget)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="One-time code"
        class="absolute inset-0 z-10 size-full cursor-text opacity-0"
      />
      <div class="flex justify-between gap-2">
        <Index each={Array.from({ length: length() })}>
          {(_, index) => (
            <div
              class={cn(
                'flex h-13 flex-1 items-center justify-center rounded-lg border bg-surface text-lg font-medium tabular-nums text-ink transition-colors',
                focused() && index === activeIndex()
                  ? 'border-accent'
                  : 'border-edge'
              )}
            >
              {props.value[index] ?? ''}
            </div>
          )}
        </Index>
      </div>
    </div>
  );
}
