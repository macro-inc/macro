import CheckIcon from '@icon/regular/check.svg';
import ExclamationIcon from '@icon/regular/exclamation-mark.svg';
import Spinner from '@icon/regular/spinner.svg';
import XIcon from '@icon/regular/x.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import type { Component } from 'solid-js';
import {
  Show,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  on,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

export enum ToastType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  ALERT = 'alert',
  LOADING = 'loading',
}

interface ToastStyle {
  background: string;
  /** Accent color for icon and icon background */
  accent: string;
  /** Border color class for animated border (Tailwind class, e.g. 'border-success') */
  borderColor: string;
  /** Text color for title */
  titleText: string;
  /** Text color for subtext/description */
  subtitleText: string;
  /** Icon component */
  icon: Component<{ class?: string }>;
  /** Action button styles */
  button: {
    background: string;
    hover: string;
    text: string;
  };
  /** Close button hover text color */
  closeButtonHover: string;
}

const TOAST_STYLES: Record<ToastType, ToastStyle> = {
  [ToastType.SUCCESS]: {
    background: 'bg-success/10',
    accent: 'bg-success',
    borderColor: 'border-success',
    titleText: 'text-success-ink',
    subtitleText: 'text-success-ink/70',
    icon: CheckIcon,
    button: {
      background: 'bg-success',
      hover: 'hover:bg-success/80',
      text: 'text-success-ink',
    },
    closeButtonHover: 'hover:text-success-ink hover:bg-success/10',
  },
  [ToastType.FAILURE]: {
    background: 'bg-failure/10',
    accent: 'bg-failure',
    borderColor: 'border-failure',
    titleText: 'text-failure-ink',
    subtitleText: 'text-failure-ink/70',
    icon: ExclamationIcon,
    button: {
      background: 'bg-failure',
      hover: 'hover:bg-failure/80',
      text: 'text-failure-ink',
    },
    closeButtonHover: 'hover:text-failure-ink hover:bg-failure/10',
  },
  [ToastType.ALERT]: {
    background: 'bg-alert/10',
    accent: 'bg-alert',
    borderColor: 'border-alert',
    titleText: 'text-alert-ink',
    subtitleText: 'text-alert-ink/70',
    icon: ExclamationIcon,
    button: {
      background: 'bg-alert',
      hover: 'hover:bg-alert/80',
      text: 'text-alert-ink',
    },
    closeButtonHover: 'hover:text-alert-ink hover:bg-alert/10',
  },
  [ToastType.LOADING]: {
    background: 'bg-accent/10',
    accent: 'bg-accent',
    borderColor: 'border-accent',
    titleText: 'text-ink',
    subtitleText: 'text-ink-muted',
    icon: Spinner,
    button: {
      background: 'bg-accent',
      hover: 'hover:bg-accent/80',
      text: 'text-panel',
    },
    closeButtonHover: 'hover:text-accent hover:bg-accent/10',
  },
};

interface ToastMessage {
  message: string;
  toastType: ToastType;
  timestamp: number;
  timeoutId: ReturnType<typeof setTimeout>;
  subtext?: string;
  action?: {
    text: string;
    onClick: () => void;
  };
}

const recentToasts: Map<string, ToastMessage> = new Map();
const THROTTLE_DURATION = 3000;

function createToastKey(message: string, type: ToastType): string {
  return `${type}:${message}`;
}

function wasRecentlyShown(message: string, type: ToastType): boolean {
  const key = createToastKey(message, type);
  const existingToast = recentToasts.get(key);

  if (!existingToast) return false;

  const now = Date.now();
  return now - existingToast.timestamp < THROTTLE_DURATION;
}

// Tell users that an action has successfully completed
function success(
  message: string,
  subtext?: string,
  action?: { text: string; onClick: () => void },
  duration?: number
): number | undefined {
  if (!wasRecentlyShown(message, ToastType.SUCCESS)) {
    return createToast(message, ToastType.SUCCESS, subtext, action, duration);
  }
}

function dismiss(toastId: number) {
  toaster.dismiss(toastId);
}

// Tell users that an action has failed, because of us
function failure(message: string, subtext?: string, duration?: number) {
  if (!wasRecentlyShown(message, ToastType.FAILURE)) {
    createToast(message, ToastType.FAILURE, subtext, undefined, duration);
  }
}

// Tell users that an action has failed, because of them
function alert(message: string, subtext?: string, duration?: number) {
  if (!wasRecentlyShown(message, ToastType.ALERT)) {
    createToast(message, ToastType.ALERT, subtext, undefined, duration);
  }
}

function ToastContent(props: {
  toastId: number;
  toastType: ToastType;
  message: string;
  subtext?: string;
  action?: { text: string; onClick: () => void };
  persistent?: boolean;
  duration?: number;
}) {
  const styles = () => TOAST_STYLES[props.toastType];

  // Track progress until disappearance (1 = full duration remaining, 0 = time to disappear)
  const [progress, setProgress] = createSignal(1);
  const [isHovered, setIsHovered] = createSignal(false);

  let elapsed = 0;

  onMount(() => {
    // Skip countdown for persistent toasts
    if (props.persistent) return;

    const duration = props.duration ?? 3000;
    let lastTime: number | null = null;
    let rafId: number;

    const update = () => {
      const currentTime = performance.now();

      // Initialize lastTime on first frame
      if (lastTime === null) {
        lastTime = currentTime;
      }

      // Only accumulate time when not hovered
      if (!isHovered()) {
        elapsed += currentTime - lastTime;
      }
      lastTime = currentTime;

      const remaining = Math.max(0, 1 - elapsed / duration);
      setProgress(remaining);

      if (remaining > 0) {
        rafId = requestAnimationFrame(update);
      } else {
        // Dismiss the toast when countdown completes
        toaster.dismiss(props.toastId);
      }
    };

    rafId = requestAnimationFrame(update);

    onCleanup(() => cancelAnimationFrame(rafId));
  });

  // Reset timer immediately when user starts hovering
  createEffect(
    on(isHovered, (hovered) => {
      if (hovered && !props.persistent) {
        // User started hovering - reset timer and progress immediately
        elapsed = 0;
        setProgress(1);
      }
    })
  );

  return (
    <Toast
      toastId={props.toastId}
      class={`relative overflow-visible rounded-xs pointer-events-auto
        bg-panel
        data-opened:animate-slide-in data-closed:animate-hide transition-transform data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)]
        data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out`}
      persistent={true}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Animated border that fades from opacity 1 to 0 */}
      <Show when={!props.persistent}>
        <div
          class={`absolute inset-0 rounded-xs border-1 pointer-events-none ${styles().borderColor}`}
          style={{ opacity: progress() }}
        />
      </Show>

      <div class="flex">
        {/* Left accent area with icon */}
        <div
          class={`flex items-center justify-center w-12 shrink-0 ${styles().accent}/20`}
        >
          <Dynamic
            component={styles().icon}
            class={`size-6 ${styles().titleText} ${props.toastType === ToastType.LOADING ? 'animate-spin' : ''}`}
          />
        </div>

        {/* Content area */}
        <div class="flex-1 pt-2 px-3 pb-3 pr-10">
          <Toast.Title class={`font-semibold text-ink`}>
            {props.message}
          </Toast.Title>
          <Show when={props.subtext}>
            <Toast.Description class={`text-sm text-ink-extra-muted`}>
              {props.subtext}
            </Toast.Description>
          </Show>

          {/* Action button */}
          <Show when={props.action}>
            {(action) => (
              <button
                onClick={action().onClick}
                class={`mt-2 w-full text-sm font-semibold py-1.5 px-3 rounded
                  ${styles().button.background}/20
                  ${styles().button.hover}
                  ${styles().button.text}
                `}
              >
                {action().text}
              </button>
            )}
          </Show>
        </div>

        {/* Close button */}
        <Toast.CloseButton class="absolute top-2 right-2 p-1 rounded">
          <XIcon
            class={`size-4 text-ink-extra-muted transition-colors ${styles().closeButtonHover}`}
          />
        </Toast.CloseButton>
      </div>
    </Toast>
  );
}

async function promise<T>(
  promise: Promise<T>,
  options: {
    loading: string;
    success?: string | ((result: T) => string);
    error?: string | ((error: any) => string);
    toastTypeDeterminer?: (result: T) => ToastType;
    subtext?: string;
  }
): Promise<T> {
  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={ToastType.LOADING}
        message={options.loading}
        subtext={options.subtext}
        persistent={true}
      />
    ),
    { region: 'toast-region' }
  );

  return promise
    .then((result) => {
      toaster.dismiss(toastId);

      if (options.success) {
        const successMessage =
          typeof options.success === 'function'
            ? options.success(result)
            : options.success;

        const toastType =
          options.toastTypeDeterminer?.(result) ?? ToastType.SUCCESS;

        createToast(successMessage, toastType);
      }

      return result;
    })
    .catch((error) => {
      toaster.dismiss(toastId);
      if (options.error) {
        const errorMessage =
          typeof options.error === 'function'
            ? options.error(error)
            : options.error;
        failure(errorMessage);
      }
      throw error;
    });
}

function createToast(
  message: string,
  toastType: ToastType,
  subtext?: string,
  action?: { text: string; onClick: () => void },
  duration?: number
) {
  const key = createToastKey(message, toastType);

  const existingToast = recentToasts.get(key);
  if (existingToast?.timeoutId) {
    clearTimeout(existingToast.timeoutId);
  }

  const timeoutId = setTimeout(() => {
    recentToasts.delete(key);
  }, THROTTLE_DURATION);

  recentToasts.set(key, {
    message,
    toastType,
    timestamp: Date.now(),
    timeoutId,
    subtext,
    action,
  });

  return toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={toastType}
        message={message}
        subtext={subtext}
        action={action}
        duration={duration ?? THROTTLE_DURATION + 100}
      />
    ),
    { region: 'toast-region' }
  );
}

function embed(
  component: Component,
  options?: {
    persistent?: boolean;
    duration?: number;
    region?: string;
  }
) {
  return toaster.show(
    (props) => (
      <Toast
        toastId={props.toastId}
        class="flex flex-col items-center justify-between gap-2 border rounded-md p-3 pointer-events-auto border-edge-muted bg-panel relative
          data-opened:animate-slide-in data-closed:animate-hide transition-transform data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)]
          data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out"
        duration={options?.duration}
        persistent={options?.persistent}
      >
        <div class="size-full">
          <Dynamic component={component} />
        </div>
        <Toast.CloseButton class="ml-auto absolute top-2 right-2 z-1">
          <XIcon class="h-5 ml-4 text-[oklch(0.551_0.027_264.364)]" />
        </Toast.CloseButton>
      </Toast>
    ),
    { region: options?.region || 'toast-region' }
  );
}

export function createUploadToast(message: string) {
  return toaster.show(
    (props) => (
      <Toast
        toastId={props.toastId}
        persistent={true}
        class={`flex flex-col items-center justify-between gap-2 border rounded-md p-3 shadow-lg bg-menu border-edge-muted pointer-events-auto
                data-opened:animate-slide-in data-closed:animate-hide transition-transform data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)]
                data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out`}
      >
        <div class="flex items-center w-full">
          <Spinner class="mr-3 h-7 animate-spin shrink-0" />
          <div>
            <Toast.Title>{message}</Toast.Title>
          </div>
          <Toast.CloseButton class="ml-auto">
            <XIcon class={`h-5 ml-4`} />
          </Toast.CloseButton>
        </div>
      </Toast>
    ),
    { region: 'stable-toast' }
  );
}

export const toast = {
  success,
  failure,
  alert,
  promise,
  embed,
  dismiss,
};
