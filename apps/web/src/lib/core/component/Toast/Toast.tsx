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
  /** Directional actions place their icon after the label. */
  trailingIcon?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'accent';
  onClick: () => void;
}

type ToastActionLayout = 'stacked' | 'inline';
export type ToastDismissStyle = 'button' | 'icon';

/**
 * Common options for all toast calls.
 */
interface ToastOptions {
  subtext?: string;
  /** Entity glyph beside the title, separate from the toast's status icon. */
  titleIcon?: Component<{ class?: string }>;
  /** Auto-dismiss duration in ms. When omitted, the toast uses a default 4.5s timer. */
  duration?: number;
  /** When true, don't render this toast on mobile. */
  hideOnMobile?: boolean;
  /** Hide the visible dismissal control; Escape, swipe, and expiry stay unchanged. */
  showCloseButton?: boolean;
  /** Replace an action toast's Dismiss button with a desktop close icon. */
  dismissStyle?: ToastDismissStyle;
  /** Inline multiple actions on notices without a description; single actions inline automatically. */
  actionLayout?: ToastActionLayout;
  /**
   * Runs once the toast closes, however it closes: expiry, its close
   * control, Escape, a swipe, or `toast.dismiss`.
   */
  onDismiss?: () => void;
  /**
   * A toast this one takes the place of: while that toast is still open it
   * changes in place and keeps its id, so one process (a send, say) shows one
   * toast through each of its states. Its options, `onDismiss` included,
   * replace the earlier ones, and a timed toast starts its timer again. A
   * closed toast leaves this one to open as usual.
   */
  replace?: number;
}

interface ToastActionOptions extends ToastOptions {
  actions?: ToastAction[];
  /** When true, bypasses the 3s duplicate-message throttle. */
  stack?: boolean;
  /** Stays until dismissed or, on mobile, until the next notice replaces it. */
  persistent?: boolean;
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
  /** Optional title color; descriptions and action colors stay independent. */
  titleColor?: string;
  actions?: ToastAction[];
  actionLayout?: ToastActionLayout;
  /** Label for the secondary dismissal action; defaults to Dismiss. */
  dismissLabel?: string;
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
  dismiss(activeId);
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
    dismiss(existingToast.toastId);
  }
}

// Tell users that an action has successfully completed
function success(
  message: string,
  options?: ToastActionOptions
): number | undefined {
  return createToast(message, ToastType.SUCCESS, options);
}

function dismiss(toastId: number) {
  // A toast queued past its region's limit never mounts, so its cleanup
  // can't be what closes it.
  const open = openToasts.get(toastId);
  openToasts.delete(toastId);
  if (open && !open.mounted()) open.close();
  toaster.dismiss(toastId);
}

// Tell users that an action has failed, because of us
function failure(
  message: string,
  options?: ToastActionOptions
): number | undefined {
  return createToast(message, ToastType.FAILURE, options);
}

// Tell users that an action has failed, because of them
function alert(
  message: string,
  options?: ToastActionOptions
): number | undefined {
  return createToast(message, ToastType.ALERT, options);
}

function ActionButtons(props: {
  actions: ToastAction[];
  showDismiss: boolean;
  dismissLabel: string;
  onDismiss?: () => void;
}) {
  return (
    <>
      <Show when={props.showDismiss}>
        <Toast.CloseButton
          as={Button}
          size="sm"
          variant="secondary"
          aria-label={props.dismissLabel}
          onClick={() => props.onDismiss?.()}
        >
          {props.dismissLabel}
        </Toast.CloseButton>
      </Show>
      <For each={props.actions}>
        {(action) => (
          <Button
            size="sm"
            onClick={action.onClick}
            variant={action.variant ?? 'primary'}
            class="max-w-full"
          >
            <Show when={action.icon}>
              {(Icon) => (
                <Dynamic
                  component={Icon()}
                  class={cn(
                    'size-4 shrink-0',
                    action.trailingIcon && 'order-last'
                  )}
                />
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

type ToastContentProps = {
  toastId: number;
  toastType?: ToastType;
  message?: string;
  subtext?: string;
  titleIcon?: Component<{ class?: string }>;
  actions?: ToastAction[];
  actionLayout?: ToastActionLayout;
  persistent?: boolean;
  duration?: number;
  embed?: Component;
  custom?: CustomToastConfig;
  showCloseButton?: boolean;
  dismissStyle?: ToastDismissStyle;
  onDismiss?: () => void;
  onUserDismiss?: () => void;
  /** Counts in-place replacements; each one restarts a timed toast's timer. */
  revision?: number;
};

/** Shared presentation for the app service and isolated gallery regions. */
export function ToastContent(props: ToastContentProps) {
  onCleanup(() => props.onDismiss?.());

  // Kobalte's close timer doesn't follow a change to `persistent`, nor start
  // again for new content, so a toast updated in place to new timing (a
  // persistent "Sending…" becoming a timed "Sent"), or a timed toast given
  // new content, mounts a fresh frame, without the entrance animation.
  let mounted = false;
  const timing = () =>
    props.persistent
      ? 'persistent'
      : `${props.duration}:${props.revision ?? 0}`;
  return (
    <Show when={timing()} keyed>
      {/* Show re-renders only a child that takes the value. */}
      {(_timing) => {
        const replaced = mounted;
        mounted = true;
        return <ToastFrame {...props} replaced={replaced} />;
      }}
    </Show>
  );
}

function ToastFrame(props: ToastContentProps & { replaced: boolean }) {
  const styles = () =>
    props.toastType ? TOAST_STYLES[props.toastType] : undefined;
  const icon = () => props.custom?.icon ?? styles()?.icon;
  const actions = () => props.custom?.actions ?? props.actions ?? [];
  const hasBody = () => Boolean(props.custom?.content || props.subtext);
  const hasActions = () => actions().length > 0;
  const inlineActions = () =>
    !props.embed &&
    !hasBody() &&
    hasActions() &&
    (actions().length === 1 ||
      (props.custom?.actionLayout ?? props.actionLayout) === 'inline');
  const singleRow = () =>
    !props.embed && !hasBody() && (!hasActions() || inlineActions());
  const dismissLabel = () => props.custom?.dismissLabel ?? t('common.dismiss');
  const showDismiss = () => props.showCloseButton !== false;
  const showDismissAction = () =>
    showDismiss() && props.dismissStyle !== 'icon';
  const showCloseButton = () =>
    showDismiss() &&
    (!hasActions() || props.dismissStyle === 'icon') &&
    !isMobile();
  const [height, setHeight] = createSignal<number>();
  let surface!: HTMLDivElement;

  // Keep the natural height while older cards are tucked into the stack.
  // Read it once at mount, so the entrance keyframes start from the real
  // height rather than their fallback, then from the observer's entries:
  // reading layout in the callback would force a style and layout pass of
  // whatever an earlier callback in that frame dirtied, in every frame the
  // card resizes.
  onMount(() => {
    setHeight(surface.offsetHeight);
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0];
      if (size) setHeight(size.blockSize);
    });
    observer.observe(surface, { box: 'border-box' });
    onCleanup(() => observer.disconnect());
  });

  return (
    <Toast
      toastId={props.toastId}
      data-macro-toast
      data-toast-id={props.toastId}
      data-replaced={props.replaced ? '' : undefined}
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
            showCloseButton() && (hasActions() ? 'pr-8' : 'pr-10')
          )}
        >
          <Show
            when={props.embed}
            fallback={
              <div class={cn('min-w-0', icon() && 'pl-7')}>
                <div class="macro-toast-heading flex min-w-0 flex-wrap items-center gap-2">
                  <Toast.Title
                    class="relative min-w-0 flex-auto text-base font-medium leading-normal text-ink wrap-anywhere"
                    style={{ color: props.custom?.titleColor }}
                  >
                    <Show when={icon()}>
                      {(Icon) => (
                        <span
                          aria-hidden="true"
                          class={cn(
                            'absolute top-0.5 -left-7 flex size-5 items-center justify-center',
                            props.custom
                              ? 'text-ink-muted'
                              : styles()?.iconClass
                          )}
                          style={
                            props.custom
                              ? { color: props.custom.color }
                              : undefined
                          }
                        >
                          <Dynamic
                            component={Icon()}
                            class={props.custom ? 'size-4' : 'size-5'}
                          />
                        </span>
                      )}
                    </Show>
                    <Show when={props.titleIcon}>
                      {(Icon) => (
                        <Dynamic
                          component={Icon()}
                          class="mr-1 inline-block size-4 align-text-bottom text-ink-muted"
                          aria-hidden="true"
                        />
                      )}
                    </Show>
                    {props.custom?.title ?? props.message}
                  </Toast.Title>
                  <Show when={inlineActions()}>
                    <div class="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                      <ActionButtons
                        actions={actions()}
                        showDismiss={showDismissAction()}
                        dismissLabel={dismissLabel()}
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
                      showDismiss={showDismissAction()}
                      dismissLabel={dismissLabel()}
                      onDismiss={props.onUserDismiss}
                    />
                  </div>
                </Show>
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
                      showDismiss={showDismissAction()}
                      dismissLabel={dismissLabel()}
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

// ─── showToast (internal) ────────────────────────────────────────────────────

type ShownToast = Omit<ToastContentProps, 'toastId' | 'revision'>;

/** Open toasts by id, with their region and the setter `replace` changes them through. */
const openToasts = new Map<
  number,
  {
    region: string;
    update: (content: ShownToast) => void;
    mounted: () => boolean;
    close: () => void;
  }
>();

/**
 * Show a toast in `region`, or change the open toast `replace` names in place.
 * A toast that `holdsSlot` is the one the next mobile notice replaces.
 */
function showToast(
  region: string,
  content: ShownToast,
  replace: number | undefined,
  holdsSlot: boolean
): number {
  const open = replace === undefined ? undefined : openToasts.get(replace);
  if (replace !== undefined && open) {
    open.update(content);
    // The throttle must not dismiss this toast for a message it no longer shows.
    for (const [key, recent] of recentToasts) {
      if (recent.toastId !== replace) continue;
      clearTimeout(recent.timeoutId);
      recentToasts.delete(key);
    }
    if (!holdsSlot) {
      clearTrackedToast(open.region, replace);
    } else {
      if (getActiveToastId(open.region) !== replace)
        dismissActiveToast(open.region);
      setActiveToastId(open.region, replace);
    }
    return replace;
  }

  replaceActiveToast(region, !holdsSlot);
  const [current, setCurrent] = createSignal({ ...content, revision: 0 });
  let mounted = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openToasts.delete(toastId);
    clearTrackedToast(region, toastId);
    current().onDismiss?.();
  };
  const toastId = toaster.show(
    (props) => {
      mounted = true;
      return (
        <ToastContent
          {...current()}
          toastId={props.toastId}
          onDismiss={close}
        />
      );
    },
    { region }
  );
  openToasts.set(toastId, {
    region,
    update: (next) =>
      setCurrent((previous) => ({ ...next, revision: previous.revision + 1 })),
    mounted: () => mounted,
    close,
  });
  trackActiveToast(region, toastId, !holdsSlot);
  return toastId;
}

// ─── createToast (internal) ──────────────────────────────────────────────────

function createToast(
  message: string,
  toastType: ToastType,
  options?: ToastActionOptions
) {
  const {
    subtext,
    titleIcon,
    actions,
    actionLayout,
    duration,
    stack,
    hideOnMobile,
    showCloseButton,
    dismissStyle,
    onDismiss,
    persistent,
    replace,
  } = options ?? {};

  if (isMobile() && hideOnMobile) return undefined;

  // A toast changing in place may already show this message, and its later
  // states are not new messages to throttle.
  const replacing = replace !== undefined && openToasts.has(replace);
  if (!stack && !replacing) {
    dismissIfRecent(message, toastType);
    const key = createToastKey(message, toastType);
    const existingToast = recentToasts.get(key);
    if (existingToast?.timeoutId) {
      clearTimeout(existingToast.timeoutId);
    }
  }

  const useMobile = isMobile();
  const region = useMobile ? 'mobile-toast-region' : 'toast-region';
  const toastId = showToast(
    region,
    {
      toastType,
      message,
      subtext,
      titleIcon,
      actions,
      actionLayout,
      duration,
      persistent,
      showCloseButton,
      dismissStyle,
      onDismiss,
    },
    replace,
    true
  );

  if (!stack && !replacing) {
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
    dismissStyle?: ToastDismissStyle;
    /** See `ToastOptions.replace`. */
    replace?: number;
  }
): number {
  const useMobile = isMobile();
  const region =
    options?.region ?? (useMobile ? 'mobile-toast-region' : 'toast-region');
  return showToast(
    region,
    {
      custom: config,
      persistent: options?.persistent,
      duration: options?.duration,
      onUserDismiss: options?.onUserDismiss,
      showCloseButton: options?.showCloseButton,
      dismissStyle: options?.dismissStyle,
      onDismiss: options?.onDismiss,
    },
    options?.replace,
    !options?.persistent
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
