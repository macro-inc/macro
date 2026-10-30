import './toast.css';
import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import CheckIcon from '@icon/system/bold/check-bold.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import { Button, cn, Spinner } from '@ui';
import type { Component, JSX } from 'solid-js';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export enum ToastType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  ALERT = 'alert',
  LOADING = 'loading',
}

const TOAST_STYLES: Record<
  ToastType,
  { icon: Component<{ class?: string }>; iconClass: string }
> = {
  [ToastType.SUCCESS]: {
    icon: CheckIcon,
    iconClass: 'text-success',
  },
  [ToastType.FAILURE]: {
    icon: ExclamationIcon,
    iconClass: 'text-failure',
  },
  [ToastType.ALERT]: {
    icon: WarningIcon,
    iconClass: 'text-warning',
  },
  [ToastType.LOADING]: {
    icon: (props) => <Spinner {...props} size="md" decorative />,
    iconClass: 'text-accent',
  },
};

/** A single entry in the actions row — icon and label rendered as a button */
interface ToastAction {
  label: string;
  icon?: Component<{ class?: string }>;
  onClick: () => void;
}

type ToastActionLayout = 'stacked' | 'inline';

/**
 * Common options for all toast calls.
 */
interface ToastOptions {
  subtext?: string;
  /** Auto-dismiss duration in ms. When omitted, the toast uses a default 4.5s timer. */
  duration?: number;
  /** When true, don't render this toast on mobile. */
  hideOnMobile?: boolean;
  /** Hide the visible dismissal control; Escape, swipe, and expiry stay unchanged. */
  showCloseButton?: boolean;
  /** Place actions beside the title; defaults to a stacked action row. */
  actionLayout?: ToastActionLayout;
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
  actionLayout?: ToastActionLayout;
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

function ActionButtons(props: {
  actions: ToastAction[];
  showDismiss: boolean;
  onDismiss?: () => void;
}) {
  return (
    <>
      <Show when={props.showDismiss}>
        <Toast.CloseButton
          as={Button}
          size="sm"
          variant="secondary"
          aria-label={t('common.dismiss')}
          onClick={() => props.onDismiss?.()}
        >
          {t('common.dismiss')}
        </Toast.CloseButton>
      </Show>
      <For each={props.actions}>
        {(action) => (
          <Button
            size="sm"
            onClick={action.onClick}
            variant="primary"
            class="max-w-full"
          >
            <Show when={action.icon}>
              {(icon) => (
                <Dynamic component={icon()} class="size-3.5 shrink-0" />
              )}
            </Show>
            <span class="min-w-0 whitespace-normal break-words">
              {action.label}
            </span>
          </Button>
        )}
      </For>
    </>
  );
}

/** Shared presentation for the app service and isolated gallery regions. */
export function ToastContent(props: {
  toastId: number;
  toastType?: ToastType;
  message?: string;
  subtext?: string;
  actions?: ToastAction[];
  actionLayout?: ToastActionLayout;
  persistent?: boolean;
  duration?: number;
  embed?: Component;
  custom?: CustomToastConfig;
  showCloseButton?: boolean;
  onDismiss?: () => void;
  onUserDismiss?: () => void;
}) {
  const styles = () =>
    props.toastType ? TOAST_STYLES[props.toastType] : undefined;
  const icon = () => props.custom?.icon ?? styles()?.icon;
  const actions = () => props.custom?.actions ?? props.actions ?? [];
  const hasBody = () => Boolean(props.custom?.content || props.subtext);
  const hasActions = () => actions().length > 0;
  const inlineActions = () =>
    !props.embed &&
    hasActions() &&
    (props.custom?.actionLayout ?? props.actionLayout) === 'inline';
  const singleRow = () =>
    !props.embed && !hasBody() && (!hasActions() || inlineActions());
  const showDismiss = () => props.showCloseButton !== false;
  const showCloseButton = () => showDismiss() && !hasActions() && !isMobile();
  const [height, setHeight] = createSignal<number>();
  let surface!: HTMLDivElement;

  // Keep the natural height while older cards are tucked into the stack.
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
      data-mobile={isMobile() ? '' : undefined}
      data-single-row={singleRow() ? '' : undefined}
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
        <div
          class={cn(
            'macro-toast-content min-w-0',
            showCloseButton() && 'pr-10'
          )}
        >
          <Show
            when={props.embed}
            fallback={
              <div
                class={cn(
                  'flex min-w-0 gap-2',
                  singleRow() ? 'items-center' : 'items-start'
                )}
              >
                <Show when={icon()}>
                  {(Icon) => (
                    <span
                      aria-hidden="true"
                      class={cn(
                        'flex size-5 shrink-0 items-center justify-center',
                        !singleRow() && 'mt-0.5',
                        props.custom ? 'text-ink-muted' : styles()?.iconClass
                      )}
                      style={
                        props.custom ? { color: props.custom.color } : undefined
                      }
                      data-icon-motion="none"
                    >
                      <Dynamic
                        component={Icon()}
                        class={props.custom ? 'size-4' : 'size-5'}
                      />
                    </span>
                  )}
                </Show>
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <Toast.Title class="min-w-0 flex-auto text-base font-medium leading-normal text-ink wrap-anywhere">
                      {props.custom?.title ?? props.message}
                    </Toast.Title>
                    <Show when={inlineActions()}>
                      <div class="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                        <ActionButtons
                          actions={actions()}
                          showDismiss={showDismiss()}
                          onDismiss={props.onUserDismiss}
                        />
                      </div>
                    </Show>
                  </div>
                  <Show when={hasBody()}>
                    <Toast.Description class="mt-0.5 text-sm leading-normal text-ink-muted wrap-anywhere">
                      {props.custom?.content
                        ? props.custom.content()
                        : props.subtext}
                    </Toast.Description>
                  </Show>
                  <Show when={hasActions() && !inlineActions()}>
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                      <ActionButtons
                        actions={actions()}
                        showDismiss={showDismiss()}
                        onDismiss={props.onUserDismiss}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            }
          >
            {(Embed) => (
              <div class="min-w-0">
                <Dynamic component={Embed()} />
                <Show when={hasActions()}>
                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <ActionButtons
                      actions={actions()}
                      showDismiss={showDismiss()}
                      onDismiss={props.onUserDismiss}
                    />
                  </div>
                </Show>
              </div>
            )}
          </Show>
          <Show when={showCloseButton()}>
            <Toast.CloseButton
              as={Button}
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.close')}
              class={cn(
                'absolute right-2 z-10',
                singleRow() ? 'top-1/2 -translate-y-1/2' : 'top-2'
              )}
              onClick={() => props.onUserDismiss?.()}
            >
              <XIcon class="size-4" />
            </Toast.CloseButton>
          </Show>
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
    showCloseButton?: boolean;
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
        showCloseButton={options.showCloseButton}
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
          showCloseButton: options.showCloseButton,
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
        failure(errorMessage, {
          hideOnMobile: options.hideOnMobile,
          showCloseButton: options.showCloseButton,
        });
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
  const {
    subtext,
    actions,
    actionLayout,
    duration,
    stack,
    hideOnMobile,
    showCloseButton,
  } = options ?? {};

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
        actionLayout={actionLayout}
        duration={duration}
        showCloseButton={showCloseButton}
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
    showCloseButton?: boolean;
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
        showCloseButton={options?.showCloseButton}
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
    showCloseButton?: boolean;
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
        showCloseButton={options?.showCloseButton}
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
