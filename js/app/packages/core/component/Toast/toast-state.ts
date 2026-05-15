import type { Component, JSX } from 'solid-js';

export type ToastId = number | string;
export type ToastRegionId = 'toast-region' | 'stable-toast';

export const TOAST_DEFAULT_DURATION = 3000;
export const TOAST_EXIT_DURATION = 220;
export const TOAST_GAP = 14;
export const TOAST_MAX_VISIBLE = 3;
export const TOAST_ESTIMATED_HEIGHT = 92;

export enum ToastType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  ALERT = 'alert',
  LOADING = 'loading',
}

export interface ToastAction {
  label: string;
  icon?: Component<{ class?: string }>;
  onClick: () => void;
}

export interface CustomToastConfig {
  title: string;
  content?: () => JSX.Element;
  icon?: Component<{ class?: string }>;
  color?: string;
  actions?: ToastAction[];
}

export interface ToastRecordBase {
  id: ToastId;
  createdAt: number;
  region: ToastRegionId;
  duration?: number;
  persistent?: boolean;
  dismissible: boolean;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
}

export interface StandardToastRecord extends ToastRecordBase {
  kind: 'standard';
  toastType: ToastType;
  message: string;
  subtext?: string;
  actions?: ToastAction[];
}

export interface CustomToastRecord extends ToastRecordBase {
  kind: 'custom';
  custom: CustomToastConfig;
}

export interface EmbedToastRecord extends ToastRecordBase {
  kind: 'embed';
  embed: Component;
}

export type ToastRecord =
  | StandardToastRecord
  | CustomToastRecord
  | EmbedToastRecord;

export type ToastEvent = ToastRecord | { id?: ToastId; dismiss: true };

export type StandardToastInput = {
  kind: 'standard';
  id?: ToastId;
  toastType: ToastType;
  message: string;
  subtext?: string;
  actions?: ToastAction[];
  duration?: number;
  persistent?: boolean;
  region?: ToastRegionId;
  dismissible?: boolean;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
};

export type CustomToastInput = {
  kind: 'custom';
  id?: ToastId;
  custom: CustomToastConfig;
  duration?: number;
  persistent?: boolean;
  region?: ToastRegionId;
  dismissible?: boolean;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
};

export type EmbedToastInput = {
  kind: 'embed';
  id?: ToastId;
  embed: Component;
  duration?: number;
  persistent?: boolean;
  region?: ToastRegionId;
  dismissible?: boolean;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
};

export type ToastInput =
  | StandardToastInput
  | CustomToastInput
  | EmbedToastInput;

type Subscriber = (toast: ToastEvent) => void;

function defaultDismissible(input: ToastInput): boolean {
  if (input.kind === 'standard' && input.toastType === ToastType.LOADING) {
    return false;
  }

  return input.dismissible ?? true;
}

function toToastRecord(
  input: ToastInput,
  id: ToastId,
  createdAt: number
): ToastRecord {
  const base: ToastRecordBase = {
    id,
    createdAt,
    duration: input.duration,
    persistent: input.persistent,
    region: input.region ?? 'toast-region',
    dismissible: defaultDismissible(input),
    onDismiss: input.onDismiss,
    onAutoClose: input.onAutoClose,
  };

  switch (input.kind) {
    case 'standard':
      return {
        ...base,
        kind: 'standard',
        toastType: input.toastType,
        message: input.message,
        subtext: input.subtext,
        actions: input.actions,
      };
    case 'custom':
      return {
        ...base,
        kind: 'custom',
        custom: input.custom,
      };
    case 'embed':
      return {
        ...base,
        kind: 'embed',
        embed: input.embed,
      };
  }
}

export function orderToastRecords<T extends ToastRecord>(toasts: T[]): T[] {
  return [...toasts].sort((left, right) => {
    if (left.region !== right.region) {
      return left.region === 'stable-toast' ? 1 : -1;
    }

    return right.createdAt - left.createdAt;
  });
}

export class ToastManager {
  private subscribers: Subscriber[] = [];
  private toasts: ToastRecord[] = [];
  private nextId = 1;

  subscribe(subscriber: Subscriber) {
    this.subscribers.push(subscriber);

    return () => {
      this.subscribers = this.subscribers.filter(
        (entry) => entry !== subscriber
      );
    };
  }

  show(input: ToastInput): ToastId {
    const id =
      typeof input.id === 'number' ||
      (typeof input.id === 'string' && input.id.length > 0)
        ? input.id
        : this.nextId++;
    const existingIndex = this.toasts.findIndex((toast) => toast.id === id);

    if (existingIndex >= 0) {
      const existing = this.toasts[existingIndex];
      const next = toToastRecord(input, id, existing.createdAt);
      this.toasts = [
        ...this.toasts.slice(0, existingIndex),
        next,
        ...this.toasts.slice(existingIndex + 1),
      ];
      this.publish(next);
      return id;
    }

    const record = toToastRecord(input, id, Date.now());
    this.toasts = [...this.toasts, record];
    this.publish(record);
    return id;
  }

  dismiss(id?: ToastId) {
    if (id == null) {
      const ids = this.toasts.map((toast) => toast.id);
      this.toasts = [];
      ids.forEach((toastId) => this.publish({ id: toastId, dismiss: true }));
      return;
    }

    this.toasts = this.toasts.filter((toast) => toast.id !== id);
    this.publish({ id, dismiss: true });
  }

  getActiveToasts() {
    return orderToastRecords(this.toasts);
  }

  private publish(event: ToastEvent) {
    this.subscribers.forEach((subscriber) => subscriber(event));
  }
}

export const toastManager = new ToastManager();
