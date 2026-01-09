import CheckCircle from '@icon/regular/check-circle.svg';
import Spinner from '@icon/regular/spinner.svg';
import Warning from '@icon/regular/warning.svg';
import WarningCircle from '@icon/regular/warning-circle.svg';
import XIcon from '@icon/regular/x.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export enum ToastType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  ALERT = 'alert',
  LOADING = 'loading',
}

interface ToastStyle {
  background: string;
  border: string;
  text: string;
  icon: Component;
  button: {
    background: string;
    hover: string;
    text: string;
  };
}

const TOAST_STYLES: Record<ToastType, ToastStyle> = {
  [ToastType.SUCCESS]: {
    background: 'floating-success-bg',
    border: 'border-success/30',
    text: 'text-success-ink',
    icon: CheckCircle,
    button: {
      background: 'bg-success/15',
      hover: 'hover:bg-success/30',
      text: 'text-success-ink',
    },
  },
  [ToastType.FAILURE]: {
    background: 'floating-failure-bg',
    border: 'border-failure/30',
    text: 'text-failure-ink',
    icon: WarningCircle,
    button: {
      background: 'bg-failure/15',
      hover: 'hover:bg-failure/30',
      text: 'text-failure-ink',
    },
  },
  [ToastType.ALERT]: {
    background: 'floating-alert-bg',
    border: 'border-alert/30',
    text: 'text-alert-ink',
    icon: Warning,
    button: {
      background: 'bg-alert/15',
      hover: 'hover:bg-alert/30',
      text: 'text-alert-ink',
    },
  },
  [ToastType.LOADING]: {
    // SCUFFED: how do we want to handle these color?
    background: 'bg-[oklch(0.623_0.214_259.815)/0.15]',
    border: 'border-[color:oklch(0.882_0.059_254.128)]',
    text: 'text-[oklch(0.488_0.243_264.376)]',
    icon: Spinner,
    button: {
      background: 'bg-[oklch(0.932_0.032_255.585)]',
      hover: 'hover:bg-[oklch(0.882_0.059_254.128)]',
      text: 'text-[oklch(0.488_0.243_264.376)]',
    },
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
) {
  if (!wasRecentlyShown(message, ToastType.SUCCESS)) {
    createToast(message, ToastType.SUCCESS, subtext, action, duration);
  }
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
  return (
    <Toast
      toastId={props.toastId}
      class={`flex flex-col items-center justify-between gap-2 border rounded-md p-3 pointer-events-auto
        ${TOAST_STYLES[props.toastType].background}
        ${TOAST_STYLES[props.toastType].border}
        ${TOAST_STYLES[props.toastType].text}
        data-opened:animate-slide-in data-closed:animate-hide transition-transform data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)]
        data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:ease-out data-[swipe=cancel]:duration-200 data-[swipe=end]:animate-swipe-out`}
      duration={props.duration}
      persistent={props.persistent}
    >
      <div class="flex flex-col gap-2 w-full">
        <div class="flex items-center w-full">
          <Dynamic
            component={TOAST_STYLES[props.toastType].icon as any}
            class={`h-7 shrink-0 ${TOAST_STYLES[props.toastType].text} mr-3 ${
              props.toastType === ToastType.LOADING ? 'animate-spin' : ''
            }`}
          />
          <div>
            <Toast.Title
              class={`${props.subtext ? 'text-lg font-semibold' : 'text-normal font-medium'}`}
            >
              {props.message}
            </Toast.Title>
            {props.subtext && (
              <Toast.Description class="opacity-70 font-medium text-sm leading-[21px]">
                {props.subtext}
              </Toast.Description>
            )}
          </div>
          <Toast.CloseButton class="ml-auto">
            <XIcon
              class={`h-5 ml-4
                ${TOAST_STYLES[props.toastType].button.text}
                `}
            />
          </Toast.CloseButton>
        </div>
        {props.action && (
          <button
            onClick={props.action.onClick}
            class={`w-full text-sm font-semibold py-1.5 px-3 rounded-md
              ${TOAST_STYLES[props.toastType].button.background}
              ${TOAST_STYLES[props.toastType].button.hover}
              ${TOAST_STYLES[props.toastType].button.text}
              `}
          >
            {props.action.text}
          </button>
        )}
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
};
