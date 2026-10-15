import './toast.css';
import { isMobile } from '@core/mobile/isMobile';
import CheckIcon from '@icon/system/regular/check.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import Spinner from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import { Button, cn } from '@ui';
import type { Component, JSX } from 'solid-js';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export enum ToastType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  ALERT = 'alert',
  LOADING = 'loading',
}

const TOAST_STYLES = {
  [ToastType.SUCCESS]: { icon: CheckIcon, color: 'var(--color-success)' },
  [ToastType.FAILURE]: { icon: ExclamationIcon, color: 'var(--color-failure)' },
  [ToastType.ALERT]: { icon: ExclamationIcon, color: 'var(--color-alert)' },
  [ToastType.LOADING]: { icon: Spinner, color: 'var(--color-ink-muted)' },
};

/** A single entry in the actions row — icon and label rendered as a button */
interface ToastAction {
  label: string;
  icon?: Component<{ class?: string }>;
  onClick: () => void;
}

/**
 * Common options for all toast calls.
 */
interface ToastOptions {
  subtext?: string;
  /** Auto-dismiss duration in ms. When omitted, the toast uses a default 4.5s timer. */
  duration?: number;
  /** When true, don't render this toast on mobile. */
  hideOnMobile?: boolean;
}

interface ToastActionOptions extends ToastOptions {
  actions?: ToastAction[];
  /** When true, bypasses the 3s duplicate-message throttle. */
  stack?: boolean;
}

/**
 * Config for a fully custom toast.
 * Replaces the icon, title, and accent color of the standard layout while
 * still using the shared toast chrome and dismissal behavior.
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

/**
 * Most recently created desktop toast. Desktop notifications queue through
 * the region limit; unlike mobile, new notifications do not replace this one.
 */
let activeToastId: number | undefined;
/**
 * The currently-visible mobile toast. The mobile region only shows one toast
 * at a time — each new mobile toast dismisses the previous one immediately.
 */
let activeMobileToastId: number | undefined;

function getActiveToastId(region: string): number | undefined {
  if (region === 'mobile-toast-region') return activeMobileToastId;
  if (region === 'toast-region') return activeToastId;
  return undefined;
}

function setActiveToastId(region: string, toastId: number | undefined): void {
  if (region === 'mobile-toast-region') {
    activeMobileToastId = toastId;
  } else if (region === 'toast-region') {
    activeToastId = toastId;
  }
}

function dismissActiveToast(region: string): boolean {
  if (region !== 'mobile-toast-region') return false;
  const activeId = getActiveToastId(region);
  if (activeId === undefined) return false;

  setActiveToastId(region, undefined);
  toaster.dismiss(activeId);
  return true;
}

/**
 * Replace the mobile region's single visible slot. Desktop toasts stack.
 *
 * Persistent toasts opt out of the slot entirely: they are prompts the user is
 * expected to answer, so a passing "Copied" must not tear one down, and a
 * prompt appearing must not swallow a result the user is still reading. They
 * stack in the region instead, and leave only when dismissed.
 */
function replaceActiveToast(region: string, persistent?: boolean): boolean {
  if (persistent) return false;
  return dismissActiveToast(region);
}

function trackActiveToast(
  region: string,
  toastId: number,
  persistent?: boolean
): void {
  if (persistent) return;
  setActiveToastId(region, toastId);
}

function clearTrackedToast(region: string, toastId: number): void {
  if (getActiveToastId(region) === toastId) {
    setActiveToastId(region, undefined);
  }
}

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
  options?: ToastActionOptions
): number | undefined {
  if (!options?.stack) dismissIfRecent(message, ToastType.SUCCESS);
  return createToast(message, ToastType.SUCCESS, options);
}

function dismiss(toastId: number) {
  toaster.dismiss(toastId);
}

// Tell users that an action has failed, because of us
function failure(
  message: string,
  options?: ToastOptions & { actions?: ToastAction[] }
) {
  dismissIfRecent(message, ToastType.FAILURE);
  createToast(message, ToastType.FAILURE, options);
}

// Tell users that an action has failed, because of them
function alert(
  message: string,
  options?: ToastActionOptions
): number | undefined {
  if (!options?.stack) dismissIfRecent(message, ToastType.ALERT);
  return createToast(message, ToastType.ALERT, options);
}

function ActionButtons(props: { actions: ToastAction[] }) {
  return (
    <For each={props.actions}>
      {(action) => (
        <Button
          size="sm"
          onClick={action.onClick}
          variant="ghost"
          class="h-7 rounded-lg bg-hover px-2.5 text-xs font-medium text-ink hover:bg-active"
        >
          <Show when={action.icon}>
            {(icon) => <Dynamic component={icon()} class="size-3.5" />}
          </Show>
          {action.label}
        </Button>
      )}
    </For>
  );
}

function ToastContent(props: {
  toastId: number;
  toastType?: ToastType;
  message?: string;
  subtext?: string;
  actions?: ToastAction[];
  persistent?: boolean;
  duration?: number;
  embed?: Component;
  custom?: CustomToastConfig;
  onDismiss?: () => void;
  onUserDismiss?: () => void;
}) {
  const style = () =>
    props.toastType ? TOAST_STYLES[props.toastType] : undefined;
  const icon = () => props.custom?.icon ?? style()?.icon;
  const actions = () => props.custom?.actions ?? props.actions;
  const [height, setHeight] = createSignal<number>();
  let surface!: HTMLDivElement;

  // The content keeps its natural height even when an older card is tucked
  // into the stack. This makes expansion work with async/custom content too.
  onMount(() => {
    const measure = () => setHeight(surface.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => props.onDismiss?.());

  return (
    <Toast
      toastId={props.toastId}
      data-macro-toast
      data-toast-id={props.toastId}
      class="macro-toast"
      style={{ '--toast-height': height() ? `${height()}px` : undefined }}
      persistent={props.persistent}
      duration={props.duration ?? 4500}
      onSwipeEnd={() => props.onUserDismiss?.()}
      onEscapeKeyDown={(event) => {
        if (!event.defaultPrevented) props.onUserDismiss?.();
      }}
    >
      <div ref={surface} class="macro-toast-surface">
        <div class="macro-toast-content flex items-center gap-2.5">
          <Show
            when={props.embed}
            fallback={
              <>
                <Show when={icon()}>
                  {(Icon) => (
                    <div
                      class="flex size-5 shrink-0 items-center justify-center"
                      style={{ color: props.custom?.color ?? style()?.color }}
                      data-icon-motion="none"
                    >
                      <Dynamic
                        component={Icon()}
                        class={cn(
                          'size-4',
                          props.toastType === ToastType.LOADING &&
                            'motion-safe:animate-spin'
                        )}
                      />
                    </div>
                  )}
                </Show>
                <div class="min-w-0 flex-1">
                  <Toast.Title class="text-[13px] font-medium leading-5 text-ink [overflow-wrap:anywhere]">
                    {props.custom?.title ?? props.message}
                  </Toast.Title>
                  <Show when={props.custom?.content || props.subtext}>
                    <Toast.Description class="mt-1 text-xs leading-[1.55] text-ink-muted [overflow-wrap:anywhere]">
                      {props.custom?.content
                        ? props.custom.content()
                        : props.subtext}
                    </Toast.Description>
                  </Show>
                </div>
              </>
            }
          >
            {(Embed) => (
              <div class="min-w-0 flex-1">
                <Dynamic component={Embed()} />
              </div>
            )}
          </Show>
          <Show when={actions()?.length}>
            <div class="flex shrink-0 flex-col items-end gap-1.5">
              <ActionButtons actions={actions()!} />
            </div>
          </Show>
          <Toast.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            class="macro-toast-corner-close size-6 shrink-0 text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => props.onUserDismiss?.()}
          >
            <XIcon class="size-3.5" />
          </Toast.CloseButton>
        </div>
      </div>
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
    /** When true, don't render the loading/result toasts on mobile. */
    hideOnMobile?: boolean;
  }
): Promise<T> {
  if (isMobile() && options.hideOnMobile) return promiseArg;

  const useMobile = isMobile();
  const region = useMobile ? 'mobile-toast-region' : 'toast-region';
  dismissActiveToast(region);

  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={ToastType.LOADING}
        message={options.loading}
        subtext={options.subtext}
        persistent={true}
        onDismiss={() => clearTrackedToast(region, props.toastId)}
      />
    ),
    { region }
  );
  setActiveToastId(region, toastId);

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

        createToast(successMessage, toastType, {
          hideOnMobile: options.hideOnMobile,
        });
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
        failure(errorMessage, { hideOnMobile: options.hideOnMobile });
      }
      throw error;
    });
}

// ─── createToast (internal) ──────────────────────────────────────────────────

function createToast(
  message: string,
  toastType: ToastType,
  options?: ToastActionOptions
) {
  const { subtext, actions, duration, stack, hideOnMobile } = options ?? {};

  if (isMobile() && hideOnMobile) return undefined;

  if (!stack) {
    const key = createToastKey(message, toastType);
    const existingToast = recentToasts.get(key);
    if (existingToast?.timeoutId) {
      clearTimeout(existingToast.timeoutId);
    }
  }

  const useMobile = isMobile();
  const region = useMobile ? 'mobile-toast-region' : 'toast-region';
  dismissActiveToast(region);

  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        toastType={toastType}
        message={message}
        subtext={subtext}
        actions={actions}
        duration={duration}
        onDismiss={() => {
          clearTrackedToast(region, props.toastId);
        }}
      />
    ),
    { region }
  );

  setActiveToastId(region, toastId);

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
  const useMobile = isMobile();
  const region =
    options?.region ?? (useMobile ? 'mobile-toast-region' : 'toast-region');
  replaceActiveToast(region, options?.persistent);
  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        embed={component}
        persistent={options?.persistent}
        duration={options?.duration}
        onDismiss={() => clearTrackedToast(region, props.toastId)}
      />
    ),
    { region }
  );
  trackActiveToast(region, toastId, options?.persistent);
  return toastId;
}

// ─── custom ──────────────────────────────────────────────────────────────────

/**
 * Show a toast with a fully custom title, icon, accent color, body content,
 * and actions row — while still using the shared toast chrome and
 * dismissal behavior.
 */
function custom(
  config: CustomToastConfig,
  options?: {
    persistent?: boolean;
    duration?: number;
    region?: string;
    onDismiss?: () => void;
    onUserDismiss?: () => void;
  }
): number {
  const useMobile = isMobile();
  const region =
    options?.region ?? (useMobile ? 'mobile-toast-region' : 'toast-region');
  replaceActiveToast(region, options?.persistent);
  const toastId = toaster.show(
    (props) => (
      <ToastContent
        toastId={props.toastId}
        custom={config}
        persistent={options?.persistent}
        duration={options?.duration}
        onUserDismiss={options?.onUserDismiss}
        onDismiss={() => {
          clearTrackedToast(region, props.toastId);
          options?.onDismiss?.();
        }}
      />
    ),
    { region }
  );
  trackActiveToast(region, toastId, options?.persistent);
  return toastId;
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
