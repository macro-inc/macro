import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/*
 * Shared bits for the Connected accounts integration cards: the trailing
 * "Connect" action and the small connection-state label. The card chrome itself
 * comes from the settings primitives (SettingsCard / IntegrationRow).
 */

export type ConnectionState =
  | 'connected'
  | 'attention'
  | 'disconnected'
  | 'off';

/**
 * The trailing action on an integration row. Defaults to a quiet text+arrow
 * "Connect" affordance (mirrors Linear's link-style connect button); pass
 * `variant` to render a neutral or destructive action.
 */
export function ConnectAction(props: {
  label: JSX.Element;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  /** 'connect' shows the external-link arrow; the others are plain buttons. */
  variant?: 'connect' | 'neutral' | 'danger';
}) {
  const variant = () => props.variant ?? 'connect';
  const className = () =>
    cn(
      'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-sm font-medium',
      'cursor-default transition-colors',
      'outline-none focus-visible:bg-ink/6',
      props.disabled || props.loading
        ? 'opacity-50 pointer-events-none'
        : undefined,
      variant() === 'danger'
        ? 'text-ink-muted hover:bg-ink/4 hover:text-failure'
        : 'text-ink-muted hover:bg-ink/4 hover:text-ink'
    );
  const body = (
    <>
      <Show when={props.loading}>
        <SpinnerIcon class="size-4 animate-spin" />
      </Show>
      {props.label}
      <Show when={variant() === 'connect' && !props.loading}>
        <ArrowUpRightIcon class="size-3.5 opacity-70" />
      </Show>
    </>
  );
  if (props.href) {
    const inert = () => Boolean(props.disabled || props.loading);
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={props.ariaLabel}
        aria-disabled={inert() || undefined}
        onClick={(event) => {
          if (inert()) event.preventDefault();
        }}
        class={className()}
      >
        {body}
      </a>
    );
  }
  if (!props.onClick) {
    return (
      <span aria-hidden="true" class={cn(className(), 'pointer-events-none')}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={props.disabled || props.loading}
      aria-label={props.ariaLabel}
      onClick={() => props.onClick?.()}
      class={className()}
    >
      {body}
    </button>
  );
}

/**
 * A bare connection-state dot, sized to sit beside an integration's title. The
 * state is conveyed by color (with a tooltip/aria-label for the word), so it
 * stays legible at any width — including mobile, where a text label wouldn't fit.
 */
export function StatusDot(props: { state: ConnectionState; label?: string }) {
  return (
    <span
      role="img"
      title={props.label}
      aria-label={props.label}
      class={cn(
        'inline-block size-2 shrink-0 rounded-full',
        props.state === 'connected' && 'bg-success',
        props.state === 'attention' && 'bg-failure',
        props.state === 'off' && 'bg-ink-extra-muted',
        props.state === 'disconnected' && 'bg-ink-muted'
      )}
    />
  );
}
