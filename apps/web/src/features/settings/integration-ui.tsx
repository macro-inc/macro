import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { settingsTarget } from './core/settings-target';

export function HarnessIcon(props: { children: JSX.Element }) {
  return (
    <div
      aria-hidden="true"
      class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted [&_svg]:size-5"
    >
      {props.children}
    </div>
  );
}

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
 *
 * Renders an external link when given `href`, and a non-interactive label
 * when given neither `href` nor `onClick` (for rows that are themselves the
 * button, so the row keeps a single tab stop).
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
  const inert = () => Boolean(props.disabled || props.loading);
  const className = () =>
    cn(
      'inline-flex items-center gap-1.5 h-7 touch:min-h-11 px-2 rounded-md text-sm font-medium whitespace-nowrap',
      'cursor-default transition-colors',
      'outline-none focus-visible:bg-ink/6',
      inert() && 'opacity-50 pointer-events-none',
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
      disabled={inert()}
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
        props.state === 'disconnected' && 'bg-ink-muted'
      )}
    />
  );
}

/**
 * A titled group on the Integrations page: one full-width row per
 * integration, each on its own surface, so every row reads the same way.
 */
export function IntegrationGroup(props: {
  title: string;
  description?: string;
  /** Right-aligned controls beside the heading. */
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section
      aria-label={props.title}
      data-settings-target={settingsTarget(props.title)}
      tabIndex={-1}
      class="flex min-w-0 flex-col gap-3 outline-none"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="text-lg font-medium text-ink">{props.title}</h2>
          <Show when={props.description}>
            <p class="text-sm text-ink-muted">{props.description}</p>
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="shrink-0">{props.actions}</div>
        </Show>
      </div>
      <div class="flex flex-col gap-2">{props.children}</div>
    </section>
  );
}
