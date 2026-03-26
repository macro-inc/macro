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
import { ClippedPanel } from '../ClippedPanel';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';

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
    borderColor: 'var(--color-success)',
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
    titleText: 'text-failure-ink',
    borderColor: 'var(--color-failure)',
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
    borderColor: 'var(--color-alert)',
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
    borderColor: 'var(--color-edge)',
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
  toastId?: number;
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

function dismissIfRecent(message: string, type: ToastType): void {
  const key = createToastKey(message, type);
  const existingToast = recentToasts.get(key);
  if (!existingToast) return;

  const now = Date.now();
  if (
    now - existingToast.timestamp < THROTTLE_DURATION &&
    existingToast.toastId != null
  ) {
    toaster.dismiss(existingToast.toastId);
  }
}

// Tell users that an action has successfully completed
function success(
  message: string,
  subtext?: string,
  action?: { text: string; onClick: () => void },
  duration?: number
): number | undefined {
  dismissIfRecent(message, ToastType.SUCCESS);
  return createToast(message, ToastType.SUCCESS, subtext, action, duration);
}

function dismiss(toastId: number) {
  toaster.dismiss(toastId);
}

// Tell users that an action has failed, because of us
function failure(message: string, subtext?: string, duration?: number) {
  dismissIfRecent(message, ToastType.FAILURE);
  createToast(message, ToastType.FAILURE, subtext, undefined, duration);
}

// Tell users that an action has failed, because of them
function alert(message: string, subtext?: string, duration?: number) {
  dismissIfRecent(message, ToastType.ALERT);
  createToast(message, ToastType.ALERT, subtext, undefined, duration);
}

function ToastContent(props: {
  toastId: number;
  toastType?: ToastType;
  message?: string;
  subtext?: string;
  action?: { text: string; onClick: () => void };
  persistent?: boolean;
  duration?: number;
  embed?: Component;
}) {
  const styles = () => (props.toastType ? TOAST_STYLES[props.toastType] : null);

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
      class={`relative overflow-visible pointer-events-auto shadow-md rounded-lg
        data-opened:animate-slide-in data-closed:animate-hide transition-transform data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)]
        data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out`}
      persistent={true}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <ClippedPanel
        edgeColor="var(--color-edge-muted)"
        highlightColor={styles()?.borderColor ?? 'var(--color-edge)'}
        active
        cornerRadius={'8px'}
        class="w-md p-3"
      >
        <Show
          when={props.embed}
          fallback={
            <>
              <div class="flex items-center gap-2 justify-between">
                <div
                  class="size-5 flex justify-center items-center rounded-full p-0.75"
                  style={{
                    'background-color': styles()!.borderColor,
                  }}
                >
                  <Dynamic
                    component={styles()!.icon}
                    class={cn(
                      'size-3.5 text-panel',
                      props.toastType === ToastType.LOADING
                        ? 'animate-spin'
                        : ''
                    )}
                  />
                </div>
                <Toast.Title class="font-semibold text-ink grow shrink truncate">
                  {props.message}
                </Toast.Title>
                <Toast.CloseButton>
                  <Button variant="ghost" size="icon-sm" class="rounded-xs">
                    <XIcon />
                  </Button>
                </Toast.CloseButton>
              </div>
              <Toast.Description class="text-sm text-ink-extra-muted ml-7">
                {props.subtext}
              </Toast.Description>
              <Show when={props.action}>
                {(action) => (
                  <Button
                    onClick={action().onClick}
                    variant="secondary"
                    class="mt-2 text-sm font-semibold py-1.5 px-3 ml-7 rounded px-4"
                  >
                    {action().text}
                  </Button>
                )}
              </Show>
            </>
          }
        >
          {(embed) => (
            <>
              <Dynamic component={embed()} />
              <Toast.CloseButton class="absolute top-2 right-2 z-1">
                <Button variant="ghost" size="icon-sm" class="rounded-xs">
                  <XIcon />
                </Button>
              </Toast.CloseButton>
            </>
          )}
        </Show>
      </ClippedPanel>
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

  const toastId = toaster.show(
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

  recentToasts.set(key, {
    message,
    toastType,
    timestamp: Date.now(),
    timeoutId,
    toastId,
    subtext,
    action,
  });

  return toastId;
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
      <ToastContent
        toastId={props.toastId}
        embed={component}
        persistent={options?.persistent}
        duration={options?.duration}
      />
    ),
    { region: options?.region || 'toast-region' }
  );
}

export function createUploadToast(message: string) {
  return toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={ToastType.LOADING}
        message={message}
        persistent={true}
      />
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
