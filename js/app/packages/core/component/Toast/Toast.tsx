import CheckIcon from '@icon/regular/check.svg';
import ExclamationIcon from '@icon/regular/exclamation-mark.svg';
import Spinner from '@icon/regular/spinner.svg';
import XIcon from '@icon/regular/x.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import type { Component, JSX } from 'solid-js';
import {
  Show,
  For,
  Switch,
  Match,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  on,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Panel } from '@ui';
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

/** A single entry in the actions row — icon and label rendered as a button */
export interface ToastAction {
  label: string;
  icon?: Component<{ class?: string }>;
  onClick: () => void;
}

/**
 * Config for a fully custom toast.
 * Replaces the icon, title, and accent color of the standard layout while
 * still using the shared Panel chrome and progress/dismiss machinery.
 */
export interface CustomToastConfig {
  title: string;
  content?: () => JSX.Element;
  icon?: Component<{ class?: string }>;
  /** Any CSS color value, e.g. 'var(--color-success)' or '#ff6600' */
  color?: string;
  actions?: ToastAction[];
}

interface ToastMessage {
  message: string;
  toastType: ToastType;
  timestamp: number;
  timeoutId: ReturnType<typeof setTimeout>;
  toastId?: number;
  subtext?: string;
  actions?: ToastAction[];
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
  actions?: ToastAction[],
  duration?: number,
  /** When true, bypasses the 3s dedupe so repeated calls stack instead of replacing. */
  stack?: boolean
): number | undefined {
  if (!stack) dismissIfRecent(message, ToastType.SUCCESS);
  return createToast(
    message,
    ToastType.SUCCESS,
    subtext,
    actions,
    duration,
    stack
  );
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

// ─── Shared actions row ──────────────────────────────────────────────────────

function ActionButtons(props: { actions: ToastAction[] }) {
  return (
    <For each={props.actions}>
      {(action) => (
        <Button
          onClick={action.onClick}
          variant="secondary"
          class="flex items-center gap-1.5 rounded py-1 px-2 text-sm font-semibold shrink-0"
        >
          <Show when={action.icon}>
            {(icon) => <Dynamic component={icon()} class="size-3.5 shrink-0" />}
          </Show>
          {action.label}
        </Button>
      )}
    </For>
  );
}

// ─── Toast content ───────────────────────────────────────────────────────────

function ToastContent(props: {
  toastId: number;
  toastType?: ToastType;
  message?: string;
  subtext?: string;
  actions?: ToastAction[];
  persistent?: boolean;
  /** When provided, drives the auto-dismiss timer AND shows the progress bar. */
  duration?: number;
  embed?: Component;
  custom?: CustomToastConfig;
}) {
  const styles = () => (props.toastType ? TOAST_STYLES[props.toastType] : null);

  const accentColor = () => {
    if (props.custom?.color) return props.custom.color;
    return styles()?.borderColor ?? 'var(--color-edge)';
  };

  // progress: 1 = full time remaining, 0 = expired.
  // Only meaningful (and only rendered) when props.duration is explicitly set.
  const [progress, setProgress] = createSignal(1);

  const showProgress = () => false;

  const [isHovered, setIsHovered] = createSignal(false);

  let elapsed = 0;

  onMount(() => {
    // Persistent toasts never auto-dismiss
    if (props.persistent) return;

    const duration = props.duration ?? 3000;
    let lastTime: number | null = null;
    let rafId: number;

    const update = () => {
      const currentTime = performance.now();

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
        toaster.dismiss(props.toastId);
      }
    };

    rafId = requestAnimationFrame(update);
    onCleanup(() => cancelAnimationFrame(rafId));
  });

  // Reset timer when user starts hovering
  createEffect(
    on(isHovered, (hovered) => {
      if (hovered && !props.persistent) {
        elapsed = 0;
        setProgress(1);
      }
    })
  );

  return (
    <Toast
      toastId={props.toastId}
      class={`relative overflow-visible pointer-events-auto shadow-md rounded
        data-opened:animate-slide-in data-closed:animate-hide transition-transform data-[swipe=move]:translate-x-(--kb-toast-swipe-move-x)
        data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out`}
      persistent={true}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Panel
        highlightColor={accentColor()}
        active
        class="relative w-[90vw] sm:w-md px-2 sm:p-3"
      >
        <Switch>
          {/* ── Embed layout ── */}
          <Match when={props.embed}>
            {(embed) => (
              <>
                <Dynamic component={embed()} />
                <Toast.CloseButton class="absolute top-2 right-2 z-user-highlight">
                  <Button variant="ghost" size="icon-sm" class="rounded-xs">
                    <XIcon />
                  </Button>
                </Toast.CloseButton>
              </>
            )}
          </Match>

          {/* ── Custom layout ── */}
          <Match when={props.custom}>
            {(customConfig) => (
              <>
                <div class="flex items-center gap-2 justify-between">
                  <Show when={customConfig().icon}>
                    {(icon) => (
                      <div class="size-5 flex shrink-0 justify-center items-center rounded-full p-0.75">
                        <Dynamic component={icon()} />
                      </div>
                    )}
                  </Show>
                  <Toast.Title class="font-semibold text-ink grow shrink truncate">
                    {customConfig().title}
                  </Toast.Title>
                  <Show when={customConfig().actions?.length}>
                    <ActionButtons actions={customConfig().actions!} />
                  </Show>
                  <Toast.CloseButton>
                    <Button variant="ghost" size="icon-sm" class="rounded-xs">
                      <XIcon />
                    </Button>
                  </Toast.CloseButton>
                </div>
                <Show when={customConfig().content}>
                  <div class="my-2 ml-7">{customConfig().content?.()}</div>
                </Show>
              </>
            )}
          </Match>

          {/* ── Standard layout ── */}
          <Match when={styles()}>
            {(s) => (
              <>
                <div class="flex items-center gap-2 justify-between">
                  <div
                    class="size-5 flex shrink-0 justify-center items-center rounded-full p-0.75"
                    style={{ 'background-color': s().borderColor }}
                  >
                    <Dynamic
                      component={s().icon}
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
                  <Show when={props.actions?.length}>
                    <ActionButtons actions={props.actions!} />
                  </Show>
                  <Toast.CloseButton>
                    <Button variant="ghost" size="icon-sm" class="rounded-xs">
                      <XIcon />
                    </Button>
                  </Toast.CloseButton>
                </div>
                <Show when={props.subtext}>
                  <Toast.Description class="text-sm text-ink-extra-muted ml-7">
                    {props.subtext}
                  </Toast.Description>
                </Show>
              </>
            )}
          </Match>
        </Switch>

        {/* Progress bar — only rendered when an explicit duration was passed */}
        <Show when={showProgress()}>
          <div
            class="absolute bottom-0 h-1 left-0"
            style={{
              'background-color': accentColor(),
              width: `${(1 - progress()) * 100}%`,
            }}
          />
        </Show>
      </Panel>
    </Toast>
  );
}

// ─── promise helper ──────────────────────────────────────────────────────────

async function promise<T>(
  promiseArg: Promise<T>,
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

  return promiseArg
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

// ─── createToast (internal) ──────────────────────────────────────────────────

function createToast(
  message: string,
  toastType: ToastType,
  subtext?: string,
  actions?: ToastAction[],
  // When undefined, the toast auto-dismisses after a default delay but shows NO progress bar.
  // When explicitly set, the toast uses that duration AND shows the progress bar.
  duration?: number,
  /** Skip recentToasts tracking so this toast never dedupes against a future call. */
  stack?: boolean
) {
  if (!stack) {
    const key = createToastKey(message, toastType);
    const existingToast = recentToasts.get(key);
    if (existingToast?.timeoutId) {
      clearTimeout(existingToast.timeoutId);
    }
  }

  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={toastType}
        message={message}
        subtext={subtext}
        actions={actions}
        // Pass duration only when explicitly provided — this is what gates the progress bar.
        // When undefined, ToastContent falls back to its own default dismiss timing internally.
        duration={duration}
      />
    ),
    { region: 'toast-region' }
  );

  if (!stack) {
    const key = createToastKey(message, toastType);
    const timeoutId = setTimeout(() => {
      recentToasts.delete(key);
    }, THROTTLE_DURATION);
    recentToasts.set(key, {
      message,
      toastType,
      timestamp: Date.now(),
      timeoutId,
      toastId,
      subtext,
      actions,
    });
  }

  return toastId;
}

// ─── embed ───────────────────────────────────────────────────────────────────

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

// ─── custom ──────────────────────────────────────────────────────────────────

/**
 * Show a toast with a fully custom title, icon, accent color, body content,
 * and actions row — while still using the shared Panel chrome and
 * progress/dismiss machinery.
 */
function custom(
  config: CustomToastConfig,
  options?: {
    persistent?: boolean;
    duration?: number;
    region?: string;
  }
): number {
  return toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        custom={config}
        persistent={options?.persistent}
        duration={options?.duration}
      />
    ),
    { region: options?.region || 'toast-region' }
  );
}

// ─── upload helper (kept for backwards compat) ───────────────────────────────

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

// ─── public API ──────────────────────────────────────────────────────────────

export const toast = {
  success,
  failure,
  alert,
  promise,
  embed,
  custom,
  dismiss,
};
