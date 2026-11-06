import GmailIcon from '@icon/gmail-color.svg';
import OutlookIcon from '@icon/outlook-color.svg';
import VerifiedIcon from '@icon/system/fill/seal-check-fill.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { Badge, Dropdown } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import type { InboxProvider } from '../context/onboarding-context';

/** One recommended connection: what it is, why to connect it, and its action. */
export function SuggestionRow(props: {
  icon: JSX.Element;
  /** Show a second card behind the tile: there is more than one of these. */
  stacked?: boolean;
  name: string;
  /** How it reaches Macro, labelled as in Settings → Integrations. */
  kind: 'native' | 'mcp';
  /** Context after the badge, e.g. the inbox already connected. */
  detail?: string;
  /** Mark the detail as verified, e.g. an inbox that is connected. */
  verified?: boolean;
  reason: string;
  /** The row's action, e.g. a ConnectAction. */
  children: JSX.Element;
}) {
  return (
    <li class="flex items-start gap-3 py-4 sm:items-center sm:gap-4">
      <span
        aria-hidden="true"
        class="relative size-10 shrink-0 sm:mr-[15px] sm:size-11"
      >
        <Show when={props.stacked}>
          <span class="absolute inset-0 translate-x-1.5 -translate-y-1.5 rotate-[8deg] rounded-xl border border-edge-muted bg-surface shadow-[0_3px_12px_-2px_rgb(0_0_0/0.05)]" />
        </Show>
        <span class="relative flex size-full items-center justify-center rounded-xl border border-edge-muted bg-surface shadow-[0_3px_12px_-2px_rgb(0_0_0/0.05)]">
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
            <span class="flex min-w-0 items-center gap-1 text-xs text-ink-extra-muted">
              <span class="ph-no-capture min-w-0 truncate">{props.detail}</span>
              <Show when={props.verified}>
                <span role="img" aria-label="Connected" class="flex shrink-0">
                  <VerifiedIcon class="size-3.5 text-success" />
                </span>
              </Show>
            </span>
          </Show>
        </div>
        {/* Keep descriptions 85px clear of the action on wider screens. */}
        <p class="text-xs leading-relaxed text-ink-muted sm:pr-[69px]">
          {props.reason}
        </p>
      </div>
      {props.children}
    </li>
  );
}

/** Connect, or the connection's state once it lands. */
export function ConnectAction(props: {
  name: string;
  state: 'available' | 'busy' | 'connected' | 'unavailable';
  /** The button's text while it can be pressed. */
  label: string;
  connectedLabel?: string;
  disabled: boolean;
  onConnect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={
        props.state === 'connected'
          ? `${props.connectedLabel === 'Account linked' ? 'Account linked to' : 'Connected to'} ${props.name}`
          : props.state === 'busy'
            ? `Connecting ${props.name}`
            : `${props.label} ${props.name}`
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
      <Switch fallback={props.label}>
        <Match when={props.state === 'connected'}>
          <CheckIcon aria-hidden="true" class="size-4 text-success" />
          {props.connectedLabel ?? 'Connected'}
        </Match>
        <Match when={props.state === 'busy'}>
          <SpinnerIcon aria-hidden="true" class="size-3.5 animate-spin" />
          {props.label}
        </Match>
      </Switch>
    </button>
  );
}

/** Add, opening a menu of the providers this account can connect. */
export function AddInboxMenu(props: {
  busy: boolean;
  disabled: boolean;
  outlookAvailable: boolean;
  onSelect: (provider: InboxProvider) => void;
}) {
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        ref={(el: HTMLButtonElement) => {
          trigger = el;
        }}
        as="button"
        aria-label={props.busy ? 'Adding an inbox' : 'Add another inbox'}
        aria-busy={props.busy}
        disabled={props.disabled || props.busy}
        class="flex min-h-9 shrink-0 items-center gap-1.5 self-center rounded-full border border-edge bg-surface px-4 pt-[3px] text-sm font-medium text-ink shadow-[0_2px_10px_-3px_rgb(0_0_0/0.07)] transition-colors hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
      >
        <Show when={props.busy}>
          <SpinnerIcon aria-hidden="true" class="size-3.5 animate-spin" />
        </Show>
        Add
        <CaretDownIcon aria-hidden="true" class="-mt-[3px] size-3.5" />
      </Dropdown.Trigger>
      {/* Inside the flow, the menu takes the onboarding palette, not the app's. */}
      <Dropdown.Content
        class="min-w-44"
        mount={trigger?.closest<HTMLElement>('.onboarding-flow') ?? undefined}
      >
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => props.onSelect('GMAIL')}>
            <GmailIcon aria-hidden="true" class="size-4" />
            Google
          </Dropdown.Item>
          <Show when={props.outlookAvailable}>
            <Dropdown.Item onSelect={() => props.onSelect('OUTLOOK')}>
              <OutlookIcon aria-hidden="true" class="size-4" />
              Outlook
            </Dropdown.Item>
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
