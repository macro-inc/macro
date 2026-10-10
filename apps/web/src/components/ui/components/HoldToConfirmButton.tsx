import { isTouchDevice } from '@core/mobile/isTouchDevice';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { cn } from '../utils/classname';
import { type ButtonVariantProps, buttonVariants } from './Button';
import { Layer } from './Layer';

export type HoldToConfirmButtonProps = ButtonVariantProps & {
  /** How long (ms) the button must be held to confirm. Default 5000. */
  holdDuration?: number;
  /** Called when the hold completes. */
  onConfirm: () => void;
  /** Disables the button. */
  disabled?: boolean;
  /** Show a loading state after confirmation starts. */
  pending?: boolean;
  /** Content shown while idle. */
  children: JSX.Element;
  /** Content shown while pending. If omitted, shows a spinner. */
  pendingContent?: JSX.Element;
  class?: string;
  depth?: 0 | 1 | 2 | 3 | 4;
};

const HOLD_DURATION_DEFAULT = 5000;

/**
 * A button that requires holding for a duration before triggering an action.
 * Shows a circular progress indicator around the button as user holds.
 * Works with both mouse/pointer on desktop and touch on mobile.
 *
 * @do Use for irreversible destructive actions (delete account, permanent deletion).
 * @dont Do not use for regular confirmations — use ConfirmDialog instead.
 */
export function HoldToConfirmButton(props: HoldToConfirmButtonProps) {
  const holdDuration = () => props.holdDuration ?? HOLD_DURATION_DEFAULT;
  const [progress, setProgress] = createSignal(0);
  const [isHolding, setIsHolding] = createSignal(false);

  let startTime = 0;
  let animationFrame: number | undefined;
  let startX = 0;
  let startY = 0;
  const MOVE_THRESHOLD = 15;

  const updateProgress = () => {
    if (!isHolding()) return;

    const elapsed = performance.now() - startTime;
    const newProgress = Math.min(elapsed / holdDuration(), 1);
    setProgress(newProgress);

    if (newProgress >= 1) {
      stopHold();
      props.onConfirm();
    } else {
      animationFrame = requestAnimationFrame(updateProgress);
    }
  };

  const startHold = () => {
    if (props.disabled || props.pending) return;
    startTime = performance.now();
    setIsHolding(true);
    setProgress(0);
    animationFrame = requestAnimationFrame(updateProgress);
  };

  const stopHold = () => {
    setIsHolding(false);
    setProgress(0);
    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (isTouchDevice()) return;
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    startHold();
  };

  const handlePointerUp = () => {
    if (isTouchDevice()) return;
    stopHold();
  };

  const handlePointerLeave = () => {
    if (isTouchDevice()) return;
    stopHold();
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (!isTouchDevice()) return;
    const touch = e.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    startHold();
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isTouchDevice() || !isHolding()) return;
    const touch = e.touches[0];
    if (!touch) return;

    const deltaX = Math.abs(touch.clientX - startX);
    const deltaY = Math.abs(touch.clientY - startY);
    if (Math.sqrt(deltaX * deltaX + deltaY * deltaY) > MOVE_THRESHOLD) {
      stopHold();
    }
  };

  const handleTouchEnd = () => {
    if (!isTouchDevice()) return;
    stopHold();
  };

  const handleTouchCancel = () => {
    if (!isTouchDevice()) return;
    stopHold();
  };

  createEffect(() => {
    if (props.disabled || props.pending) {
      stopHold();
    }
  });

  onCleanup(() => {
    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
    }
  });

  const strokeDashoffset = () => {
    const circumference = 2 * Math.PI * 18;
    return circumference * (1 - progress());
  };

  const variant = () => props.variant ?? 'strong';

  return (
    <Layer depth={props.depth ?? 0}>
      <div class="relative inline-flex">
        <button
          type="button"
          disabled={props.disabled || props.pending}
          class={cn(
            buttonVariants({ variant: variant(), size: props.size ?? 'md' }),
            'relative z-10 select-none',
            props.class
          )}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Show
            when={!props.pending}
            fallback={
              props.pendingContent ?? (
                <>
                  <SpinnerIcon class="size-4 animate-spin" />
                  <span class="sr-only">Processing…</span>
                </>
              )
            }
          >
            {props.children}
          </Show>
        </button>

        <Show when={isHolding() && progress() > 0}>
          <svg
            class="pointer-events-none absolute -inset-1 z-0"
            viewBox="0 0 44 44"
            style={{ transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              class="text-accent opacity-30"
            />
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray={`${2 * Math.PI * 18}`}
              stroke-dashoffset={strokeDashoffset()}
              class="text-accent transition-[stroke-dashoffset] duration-75"
            />
          </svg>
        </Show>
      </div>
    </Layer>
  );
}
