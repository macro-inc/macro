import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Button, cn } from '@ui';
import { createMemo, For, type JSX, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { SidebarItem } from './links';
import {
  formatRailUnreadCount,
  type RailGroup,
  unreadCountsByLinkId,
} from './rail-groups';

/**
 * Unread counts per destination, shared by both rails. Read it lazily (inside
 * a `Suspense` boundary): the notification query behind it can suspend.
 */
export const useRailUnreadCounts = () => {
  const notificationSource = useGlobalNotificationSource();
  return createMemo(() =>
    unreadCountsByLinkId(notificationSource.notifications())
  );
};

/**
 * A destination's unread count, badged on its icon. Rendered inside its own
 * `Suspense` by {@link RailDestination}: the notification query behind the
 * count can suspend, and that must not blank the icon it sits on.
 */
const RailUnreadBadge = (props: { count: () => number | undefined }) => (
  <Show when={props.count()}>
    {(count) => (
      <span
        role="status"
        aria-label={`${count()} unread`}
        class="absolute -top-1 -right-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent px-0.5 text-[8px] leading-none font-medium text-surface ring-1 ring-surface"
      >
        {formatRailUnreadCount(count())}
      </span>
    )}
  </Show>
);

type RailDestinationProps = {
  link: SidebarItem;
  /** Show the label under the icon (the wide left rail) or rely on the tooltip. */
  showLabel?: boolean;
  unreadCount: () => number | undefined;
  active: () => boolean;
  /** Shortcut shown in the tooltip. */
  hotkey?: HotkeyToken | HotkeyToken[];
  /** What the tooltip says this click does, e.g. "Go to Email". */
  action: string;
  onOpen: (event: MouseEvent) => void;
};

/** One destination in a nav rail: icon, unread badge, and optional label. */
export const RailDestination = (props: RailDestinationProps) => (
  <Button
    aria-label={`${props.action} ${props.link.label}`}
    data-rail-link={props.link.id}
    data-active={props.active() ? '' : undefined}
    class={cn(
      'h-auto flex-col gap-1 rounded-lg p-1',
      // Wide enough for a one-word label ("Calendar") before truncation.
      props.showLabel ? 'w-14' : 'w-8',
      props.active() && 'bg-ink/10 text-ink'
    )}
    label={`${props.action} ${props.link.label}`}
    hotkey={props.hotkey}
    tooltipPlacement={props.showLabel ? 'right' : 'left'}
    noTouchResize
    onMouseDown={(event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      props.onOpen(event);
    }}
  >
    <span class="relative flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
      <Show when={props.link.icon}>
        {(icon) => <Dynamic component={icon()} />}
      </Show>
      <Suspense>
        <RailUnreadBadge count={props.unreadCount} />
      </Suspense>
    </span>
    <Show when={props.showLabel}>
      <span class="w-full truncate text-center text-[10px] leading-none font-medium">
        {props.link.label}
      </span>
    </Show>
  </Button>
);

type RailDestinationsProps = {
  groups: RailGroup[];
  /** Rendered for each destination — the rails differ only in what a click does. */
  destination: (link: SidebarItem) => JSX.Element;
};

/**
 * The rail's scrolling body: each cluster of destinations, separated by a
 * hairline so related views read as one block.
 */
export const RailDestinations = (props: RailDestinationsProps) => (
  <div class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
    <For each={props.groups}>
      {(group, index) => (
        <>
          <Show when={index() > 0}>
            <span
              aria-hidden="true"
              class="my-0.5 h-px w-5 shrink-0 bg-edge-muted"
            />
          </Show>
          <ul
            data-rail-group={group.id}
            class="flex shrink-0 flex-col items-center gap-0.5"
          >
            <For each={group.items}>
              {(link) => (
                <li class="flex items-center justify-center">
                  {props.destination(link)}
                </li>
              )}
            </For>
          </ul>
        </>
      )}
    </For>
  </div>
);
