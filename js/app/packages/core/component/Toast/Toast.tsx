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
    background: 'floating-accent-bg',
    border: 'border-blue-200',
    text: 'text-blue-700',
    icon: Spinner,
    button: {
      background: 'bg-blue-100',
      hover: 'hover:bg-blue-200',
      text: 'text-blue-700',
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
  action?: { text: string; onClick: () => void }
) {
  if (!wasRecentlyShown(message, ToastType.SUCCESS)) {
    createToast(message, ToastType.SUCCESS, subtext, action);
  }
}

// Tell users that an action has failed, because of us
function failure(message: string, subtext?: string) {
  if (!wasRecentlyShown(message, ToastType.FAILURE)) {
    createToast(message, ToastType.FAILURE, subtext);
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
        ui-opened:animate-slide-in ui-closed:animate-hide transition-transform ui-swipe-move:translate-x-[var(--kb-toast-swipe-move-x)]
        ui-swipe-cancel:translate-x-0 ui-swipe-cancel:ease-out ui-swipe-cancel:duration-200 ui-swipe-end:animate-swipe-out`}
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
        duration={duration}
      />
    ),
    { region: 'toast-region' }
  );
}

export function createUploadToast(message: string) {
  return toaster.show(
    (props) => (
      <Toast
        toastId={props.toastId}
        persistent={true}
        class={`flex flex-col items-center justify-between gap-2 border rounded-md p-3 shadow-lg bg-amber-50 border-amber-300 text-amber-700 pointer-events-auto
                ui-opened:animate-slide-in ui-closed:animate-hide transition-transform ui-swipe-move:translate-x-[var(--kb-toast-swipe-move-x)]
                ui-swipe-cancel:translate-x-0 ui-swipe-cancel:ease-out ui-swipe-cancel:duration-200 ui-swipe-end:animate-swipe-out`}
      >
        <div class="flex items-center w-full">
          <Spinner class="fill-amber-700 mr-3 h-7 animate-spin shrink-0" />
          <div>
            <Toast.Title>{message}</Toast.Title>
          </div>
          <Toast.CloseButton class="ml-auto">
            <XIcon class={`h-5 ml-4 fill-amber-700`} />
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
};
