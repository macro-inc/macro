import { Button } from '@ui';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';

/*
 * Shared bits for the Connected accounts integration cards: the trailing
 * "Connect" action and the small connection-state label. The card chrome itself
 * comes from the settings primitives (SettingsCard / IntegrationRow).
 */

export type ConnectionState = 'connected' | 'attention' | 'disconnected';

/**
 * The trailing action on an integration row. Defaults to a quiet text+arrow
 * "Connect" affordance (mirrors Linear's link-style connect button); pass
 * `variant` to render a neutral or destructive action (e.g. Disconnect).
 */
export function ConnectAction(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 'connect' shows the external-link arrow; the others are plain buttons. */
  variant?: 'connect' | 'neutral' | 'danger';
}) {
  const variant = () => props.variant ?? 'connect';
  return (
    <button
      type="button"
      disabled={props.disabled || props.loading}
      onClick={() => props.onClick()}
      class={cn(
        'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-sm font-medium',
        'cursor-default transition-colors disabled:opacity-50',
        'outline-none focus-visible:bg-ink/6',
        variant() === 'danger'
          ? 'text-ink-muted hover:bg-ink/4 hover:text-failure'
          : 'text-ink-muted hover:bg-ink/4 hover:text-ink'
      )}
    >
      <Show when={props.loading}>
        <SpinnerIcon class="size-4 animate-spin" />
      </Show>
      {props.label}
      <Show when={variant() === 'connect' && !props.loading}>
        <ArrowUpRightIcon class="size-3.5 opacity-70" />
      </Show>
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
        props.state === 'disconnected' && 'bg-ink-muted'
      )}
    />
  );
}

/**
 * Inline secondary button used inside integration cards for compact actions
 * (Reconnect, Add inbox, …). Thin wrapper over Button so callers don't repeat
 * the size/depth/rounding each time.
 */
export function IntegrationButton(props: {
  children: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'base' | 'cta' | 'danger';
}) {
  return (
    <Button
      variant={props.variant ?? 'base'}
      size="sm"
      depth={3}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </Button>
  );
}
