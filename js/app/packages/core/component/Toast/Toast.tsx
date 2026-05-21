import { isMobile } from '@core/mobile/isMobile';
import { Toast, toaster } from '@kobalte/core/toast';
import CheckIcon from '@phosphor/check.svg';
import ExclamationIcon from '@phosphor/exclamation-mark.svg';
import Spinner from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Surface } from '@ui';
import type { Component, JSX } from 'solid-js';
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
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
      text: 'text-surface',
    },
    closeButtonHover: 'hover:text-accent hover:bg-accent/10',
  },
};

/** A single entry in the actions row — icon and label rendered as a button */
interface ToastAction {
  label: string;
  icon?: Component<{ class?: string }>;
  onClick: () => void;
}

/**
 * Common options for all toast calls.
 *
 * Note: by default, toasts do NOT render on mobile. Pass `mobile: true` to opt
 * in to the mobile-styled toast region (centered above the mobile dock).
 */
interface ToastOptions {
  subtext?: string;
  /** Auto-dismiss duration in ms. When omitted, the toast uses a default 3s timer. */
  duration?: number;
  /** When true, render this toast on mobile (in the mobile-specific region). */
  mobile?: boolean;
}

interface ToastSuccessOptions extends ToastOptions {
  actions?: ToastAction[];
  /** When true, bypasses the 3s dedupe so repeated calls stack instead of replacing. */
  stack?: boolean;
}

/**
 * Config for a fully custom toast.
 * Replaces the icon, title, and accent color of the standard layout while
 * still using the shared Surface chrome and progress/dismiss machinery.
 */
interface CustomToastConfig {
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

/** Maximum number of toasts visible at one time in the main region. */
const MAX_VISIBLE_TOASTS = 3;
/**
 * Ordered list of active (non-persistent) toast IDs in the main region,
 * oldest first. Used to evict the oldest toast when the limit is exceeded.
 */
const activeToastIds: number[] = [];
/**
 * The currently-visible mobile toast. The mobile region only shows one toast
 * at a time — each new mobile toast dismisses the previous one immediately.
 */
let activeMobileToastId: number | undefined;

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
  options?: ToastSuccessOptions
): number | undefined {
  if (!options?.stack) dismissIfRecent(message, ToastType.SUCCESS);
  return createToast(message, ToastType.SUCCESS, options);
}

function dismiss(toastId: number) {
  toaster.dismiss(toastId);
}

// Tell users that an action has failed, because of us
function failure(message: string, options?: ToastOptions) {
  dismissIfRecent(message, ToastType.FAILURE);
  createToast(message, ToastType.FAILURE, options);
}

// Tell users that an action has failed, because of them
function alert(message: string, options?: ToastOptions) {
  dismissIfRecent(message, ToastType.ALERT);
  createToast(message, ToastType.ALERT, options);
}

function ActionButtons(props: { actions: ToastAction[]; mobile?: boolean }) {
  return (
    <For each={props.actions}>
      {(action) => (
        <Button
          size={props.mobile ? 'sm' : 'md'}
          onClick={action.onClick}
          variant={props.mobile ? 'ghost' : 'base'}
          class={cn('px-2 py-1', props.mobile && 'text-panel text-xs')}
          depth={3}
        >
          <Show when={action.icon}>
            {(icon) => (
              <Dynamic
                component={icon()}
                class="size-[1em] touch:min-h-0! touch:min-w-0!"
              />
            )}
          </Show>
          {action.label}
        </Button>
      )}
    </For>
  );
}

function ToastBodyWrapper(props: {
  mobile?: boolean;
  accentColor: string;
  children: JSX.Element;
}) {
  return (
    <Show
      when={props.mobile}
      fallback={
        <Surface
          highlightColor={props.accentColor}
          class="relative w-[90vw] sm:w-md p-2 sm:p-3 rounded-xl shadow-lg shadow-drop-shadow"
          depth={2}
        >
          {props.children}
        </Surface>
      }
    >
      {props.children}
    </Show>
  );
}

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
  /** Render the mobile variant (no highlight border, text-xs, simplified). */
  mobile?: boolean;
  /** Called when this toast is removed from the DOM, so callers can clean up tracking. */
  onDismiss?: () => void;
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

  onCleanup(() => props.onDismiss?.());

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
      class={cn(
        `relative overflow-visible pointer-events-auto
        data-opened:animate-slide-in transition-[transform,opacity] duration-100 ease-in data-closed:opacity-0 data-[swipe=move]:translate-x-(--kb-toast-swipe-move-x)
        data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out`,
        props.mobile && 'w-full'
      )}
      persistent={true}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <ToastBodyWrapper mobile={props.mobile} accentColor={accentColor()}>
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
                  <Show when={customConfig().icon && !props.mobile}>
                    {(_) => {
                      const icon = customConfig().icon!;
                      return (
                        <div class="size-5 flex shrink-0 justify-center items-center rounded-full p-0.75">
                          <Dynamic component={icon} />
                        </div>
                      );
                    }}
                  </Show>
                  <Toast.Title
                    class={cn(
                      'font-semibold grow shrink truncate text-left',
                      props.mobile ? 'text-xs' : 'text-ink'
                    )}
                  >
                    {customConfig().title}
                  </Toast.Title>
                  <Show when={customConfig().actions?.length}>
                    <ActionButtons
                      actions={customConfig().actions!}
                      mobile={props.mobile}
                    />
                  </Show>
                  <Show when={!props.mobile}>
                    <Toast.CloseButton>
                      <Button variant="ghost" size="icon-sm" class="rounded-xs">
                        <XIcon />
                      </Button>
                    </Toast.CloseButton>
                  </Show>
                </div>
                <Show when={customConfig().content && !props.mobile}>
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
                  <Show when={!props.mobile}>
                    <div
                      class="size-5 flex shrink-0 justify-center items-center rounded-full p-0.75"
                      style={{ 'background-color': s().borderColor }}
                    >
                      <Dynamic
                        component={s().icon}
                        class={cn(
                          'size-3.5 text-surface',
                          props.toastType === ToastType.LOADING
                            ? 'animate-spin'
                            : ''
                        )}
                      />
                    </div>
                  </Show>
                  <Toast.Title
                    class={cn(
                      'font-semibold grow shrink truncate text-left',
                      props.mobile ? 'text-xs' : 'text-ink'
                    )}
                  >
                    {props.message}
                  </Toast.Title>
                  <Show when={props.actions?.length}>
                    <ActionButtons
                      actions={props.actions!}
                      mobile={props.mobile}
                    />
                  </Show>
                  <Show when={!props.mobile}>
                    <Toast.CloseButton>
                      <Button variant="ghost" size="icon-sm" class="rounded-xs">
                        <XIcon />
                      </Button>
                    </Toast.CloseButton>
                  </Show>
                </div>
                <Show when={props.subtext && !props.mobile}>
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
      </ToastBodyWrapper>
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
    mobile?: boolean;
  }
): Promise<T> {
  const useMobile = options.mobile && isMobile();
  const region = useMobile ? 'mobile-toast-region' : 'toast-region';

  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={ToastType.LOADING}
        message={options.loading}
        subtext={options.subtext}
        persistent={true}
        mobile={useMobile}
      />
    ),
    { region }
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

        createToast(successMessage, toastType, { mobile: options.mobile });
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
        failure(errorMessage, { mobile: options.mobile });
      }
      throw error;
    });
}

// ─── createToast (internal) ──────────────────────────────────────────────────

function createToast(
  message: string,
  toastType: ToastType,
  options?: ToastSuccessOptions
) {
  const { subtext, actions, duration, stack, mobile } = options ?? {};

  // On mobile, toasts only render when explicitly opted in via `mobile: true`.
  if (isMobile() && !mobile) return undefined;

  if (!stack) {
    const key = createToastKey(message, toastType);
    const existingToast = recentToasts.get(key);
    if (existingToast?.timeoutId) {
      clearTimeout(existingToast.timeoutId);
    }
  }

  const useMobile = mobile && isMobile();
  const region = useMobile ? 'mobile-toast-region' : 'toast-region';

  if (useMobile) {
    // Mobile region shows only the latest toast — dismiss the previous one.
    if (activeMobileToastId !== undefined) {
      toaster.dismiss(activeMobileToastId);
    }
  } else {
    // Evict the oldest visible toast when the display limit is reached, so the
    // newest toast always appears immediately instead of being queued.
    if (activeToastIds.length >= MAX_VISIBLE_TOASTS) {
      const oldestId = activeToastIds.shift();
      if (oldestId !== undefined) toaster.dismiss(oldestId);
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
        mobile={useMobile}
        onDismiss={() => {
          if (useMobile) {
            if (activeMobileToastId === props.toastId) {
              activeMobileToastId = undefined;
            }
          } else {
            const idx = activeToastIds.indexOf(props.toastId);
            if (idx !== -1) activeToastIds.splice(idx, 1);
          }
        }}
      />
    ),
    { region }
  );

  if (useMobile) {
    activeMobileToastId = toastId;
  } else {
    activeToastIds.push(toastId);
  }

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
    mobile?: boolean;
  }
) {
  const useMobile = options?.mobile && isMobile();
  const region =
    options?.region ?? (useMobile ? 'mobile-toast-region' : 'toast-region');
  return toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        embed={component}
        persistent={options?.persistent}
        duration={options?.duration}
        mobile={useMobile}
      />
    ),
    { region }
  );
}

// ─── custom ──────────────────────────────────────────────────────────────────

/**
 * Show a toast with a fully custom title, icon, accent color, body content,
 * and actions row — while still using the shared Surface chrome and
 * progress/dismiss machinery.
 */
function custom(
  config: CustomToastConfig,
  options?: {
    persistent?: boolean;
    duration?: number;
    region?: string;
    mobile?: boolean;
  }
): number {
  const useMobile = options?.mobile && isMobile();
  const region =
    options?.region ?? (useMobile ? 'mobile-toast-region' : 'toast-region');
  return toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        custom={config}
        persistent={options?.persistent}
        duration={options?.duration}
        mobile={useMobile}
      />
    ),
    { region }
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
