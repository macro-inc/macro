import ChatCircleIcon from '@phosphor/chat-circle.svg';
import HashIcon from '@phosphor/hash.svg';
import InfoIcon from '@phosphor/info.svg';
import LockIcon from '@phosphor/lock.svg';
import UsersIcon from '@phosphor/users.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import { match } from 'ts-pattern';
import type { ImportConversation, ImportJobStatus } from '../context/contracts';
import type { ConversationKind } from '../core/export';

/** `completed_with_errors` → `Completed with errors`. */
export function humanize(value: string): string {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export type StatusTone =
  | 'neutral'
  | 'active'
  | 'success'
  | 'warning'
  | 'failure';

/** A status resolved for display: the view maps domain state to this. */
export type StatusDisplay = { tone: StatusTone; label: string };

export function jobTone(status: ImportJobStatus): StatusTone {
  return match(status)
    .with('uploading', 'processing', () => 'active' as const)
    .with('completed', () => 'success' as const)
    .with('completed_with_errors', 'cancelling', () => 'warning' as const)
    .with('failed', 'cancelled', () => 'failure' as const)
    .exhaustive();
}

export function conversationTone(
  status: ImportConversation['status']
): StatusTone {
  return match(status)
    .with('awaiting_uploads', 'queued', () => 'neutral' as const)
    .with('importing', () => 'active' as const)
    .with('completed', () => 'success' as const)
    .with('skipped', () => 'warning' as const)
    .with('failed', () => 'failure' as const)
    .exhaustive();
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-ink/5 text-ink-muted',
  active: 'bg-accent-bg text-accent-ink',
  success: 'bg-success-bg text-success-ink',
  warning: 'bg-warning-bg text-warning-ink',
  failure: 'bg-failure-bg text-failure-ink',
};

/** A compact status pill; the label is the element's only text for exact lookups. */
export function StatusBadge(props: {
  tone: StatusTone;
  label: string;
  role?: string;
  class?: string;
}): JSX.Element {
  return (
    <span
      role={props.role}
      class={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[props.tone],
        props.class
      )}
    >
      {props.label}
    </span>
  );
}

const DOT_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-ink-muted',
  active: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  failure: 'bg-failure',
};

/** A bare tone dot for dense rows where a text badge would repeat the label. */
export function StatusDot(props: { tone: StatusTone }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'inline-block size-2 shrink-0 rounded-full',
        DOT_CLASS[props.tone]
      )}
    />
  );
}

const NOTICE_CLASS = {
  error: 'border-failure/30 bg-failure-bg text-failure-ink',
  warning: 'border-warning/30 bg-warning-bg text-warning-ink',
  info: 'border-edge-muted bg-ink/3 text-ink-muted',
} as const;

/** Inline message for errors, warnings and loading states inside the dialog. */
export function Notice(props: {
  tone: keyof typeof NOTICE_CLASS;
  children: JSX.Element;
  class?: string;
}): JSX.Element {
  return (
    <div
      role={props.tone === 'error' ? 'alert' : 'status'}
      class={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5',
        NOTICE_CLASS[props.tone],
        props.class
      )}
    >
      {props.tone === 'info' ? (
        <InfoIcon aria-hidden="true" class="mt-0.5 size-4 shrink-0" />
      ) : (
        <WarningCircleIcon aria-hidden="true" class="mt-0.5 size-4 shrink-0" />
      )}
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

export const CONVERSATION_KIND_LABEL: Record<ConversationKind, string> = {
  public_channel: 'Public channel',
  private_channel: 'Private channel',
  direct_message: 'Direct message',
  group_direct_message: 'Group DM',
};

export function ConversationKindIcon(props: {
  kind: ConversationKind;
  class?: string;
}): JSX.Element {
  const className = () => cn('size-4 shrink-0 text-ink-muted', props.class);
  return match(props.kind)
    .with('public_channel', () => (
      <HashIcon aria-hidden="true" class={className()} />
    ))
    .with('private_channel', () => (
      <LockIcon aria-hidden="true" class={className()} />
    ))
    .with('direct_message', () => (
      <ChatCircleIcon aria-hidden="true" class={className()} />
    ))
    .with('group_direct_message', () => (
      <UsersIcon aria-hidden="true" class={className()} />
    ))
    .exhaustive();
}

/** The native checkbox in the accent color, as the settings `ChoiceRow` uses. */
export function NativeCheckbox(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type'>
): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <input
      type="checkbox"
      class={cn('size-4 shrink-0 accent-accent', local.class)}
      {...rest}
    />
  );
}

/** Section heading inside the dialog body; mirrors the settings section label. */
export function DialogSectionTitle(props: {
  children: JSX.Element;
  class?: string;
}): JSX.Element {
  return (
    <h3 class={cn('text-sm font-semibold text-ink', props.class)}>
      {props.children}
    </h3>
  );
}
