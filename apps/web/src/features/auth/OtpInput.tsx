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

  const activeIndex = () => Math.min(props.value.length, length() - 1);

  // No native maxLength: it counts raw pasted characters, so "123 456"
  // would truncate before the separator is stripped and drop a digit.
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
        data-1p-ignore
        data-lpignore="true"
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
