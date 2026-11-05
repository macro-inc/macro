import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import CheckIcon from '@icon/system/regular/check.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { Badge } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';

/** One recommended connection: what it is, why to connect it, and the action. */
export function SuggestionRow(props: {
  icon: JSX.Element;
  /** Frame several logos in one pill instead of a square tile. */
  pill?: boolean;
  name: string;
  /** How it reaches Macro, labelled as in Settings → Integrations. */
  kind: 'native' | 'mcp';
  /** Context after the badge, e.g. the inbox already connected. */
  detail?: string;
  reason: string;
  state: 'available' | 'busy' | 'connected' | 'unavailable';
  /** The button's text while it can be pressed. */
  actionLabel: string;
  /** The button's accessible name while it can be pressed. */
  actionName: string;
  connectedLabel?: string;
  disabled: boolean;
  onConnect: () => void;
}) {
  return (
    <li class="flex items-start gap-2 py-4 sm:items-center sm:gap-3">
      {/* One column width for tiles and pills keeps every row's text aligned. */}
      <span aria-hidden="true" class="flex w-[66px] shrink-0">
        <span
          class="flex h-10 items-center justify-center border border-edge-muted bg-surface shadow-sm sm:h-11"
          classList={{
            'w-10 rounded-xl sm:w-11': !props.pill,
            'gap-1 rounded-full px-2.5': props.pill,
          }}
        >
          {props.icon}
        </span>
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-medium text-ink">{props.name}</span>
          <Badge
            variant="outline"
            size="xs"
            class="shrink-0 text-ink-muted"
            title={
              props.kind === 'mcp'
                ? 'Agents use it through an MCP server'
                : 'Built into Macro'
            }
          >
            {props.kind}
          </Badge>
          <Show when={props.detail}>
            <span class="ph-no-capture min-w-0 truncate text-xs text-ink-extra-muted">
              {props.detail}
            </span>
          </Show>
        </div>
        <p class="text-xs leading-relaxed text-ink-muted">{props.reason}</p>
      </div>
      <button
        type="button"
        aria-label={
          props.state === 'connected'
            ? `${props.connectedLabel === 'Account linked' ? 'Account linked to' : 'Connected to'} ${props.name}`
            : props.state === 'busy'
              ? `Connecting ${props.name}`
              : props.actionName
        }
        aria-busy={props.state === 'busy'}
        disabled={props.disabled || props.state !== 'available'}
        onClick={() => props.onConnect()}
        class="flex min-h-9 shrink-0 items-center gap-1.5 self-center rounded-full px-4 pt-[3px] text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        classList={{
          'border border-edge bg-surface text-ink shadow-[0_2px_10px_-3px_rgb(0_0_0/0.07)] transition-colors hover:bg-ink/5 disabled:opacity-40':
            props.state !== 'connected',
          'text-ink-muted': props.state === 'connected',
        }}
      >
        <Switch fallback={props.actionLabel}>
          <Match when={props.state === 'connected'}>
            <CheckIcon aria-hidden="true" class="size-4 text-success" />
            {props.connectedLabel ?? 'Connected'}
          </Match>
          <Match when={props.state === 'busy'}>
            <SpinnerIcon aria-hidden="true" class="size-3.5 animate-spin" />
            {props.actionLabel}
          </Match>
        </Switch>
      </button>
    </li>
  );
}

/** A placeholder row while the inbox is checked. */
export function SuggestionRowSkeleton() {
  return (
    <li aria-hidden="true" class="flex items-center gap-3 py-4">
      <span class="flex w-[66px] shrink-0">
        <ListSkeleton.Bar class="size-10 rounded-xl sm:size-11" />
      </span>
      <div class="flex flex-1 flex-col gap-2">
        <ListSkeleton.Bar class="h-3.5 w-28" />
        <ListSkeleton.Bar class="h-3 w-3/4" />
      </div>
      <ListSkeleton.Bar class="h-9 w-20 shrink-0" />
    </li>
  );
}
