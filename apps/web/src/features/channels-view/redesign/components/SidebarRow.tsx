import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Button, cn, Tooltip } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { useSidebarWorkspace } from '../context/sidebar-workspace-context';
import { formatCompactAge, type SidebarChannel } from '../core/sidebar-model';

export type SidebarRowBadge = {
  label: string;
  tone: 'warning' | 'accent' | 'neutral' | 'muted';
};

export type SidebarRowDragConfig =
  | {
      kind: 'channel';
      channelId: string;
      fromSectionId?: string;
      fromSectionScope?: 'personal' | 'team';
    }
  | {
      kind: 'favorite';
      channelId: string;
    };

export type SidebarRowProps = {
  channel: SidebarChannel;
  /** Stripped or formatted display name shown in the row. */
  displayName?: string;
  /** Row ID for DOM & keyboard navigation. */
  rowId: string;
  /** Whether keyboard roving focus is on this row. */
  focused?: boolean;
  /** Optional compact status/reason pill (Support Desk or Focus). */
  badge?: SidebarRowBadge;
  /** Optional 1-line message preview (Support Desk or Focus). */
  previewText?: string;
  /** Optional compact relative age shown on the right (e.g. "25m"). */
  ageLabel?: string;
  /** Optional sender prefix for preview line (e.g. "Customer", "Agent"). */
  senderPrefix?: string;
  /** Optional subtle visual emphasis for urgent rows. */
  urgent?: boolean;
  /** Enable drag source / reorder drop target. */
  drag?: SidebarRowDragConfig;
  /** Optional favorite reorder drop edge indicator. */
  dropEdge?: 'top' | 'bottom';
  /** Show compact inline "Join" button for unjoined channels. */
  showJoin?: boolean;
  /** Custom click override (defaults to opening channel). */
  onActivate?: (event: MouseEvent) => void;
  /** Compact density ('row' for Browse tree, 'card' for Focus / Support Desk). */
  density?: 'row' | 'card';
  /** Extra right-hand content. */
  trailing?: JSX.Element;
};

function badgeToneClass(tone: SidebarRowBadge['tone']): string {
  switch (tone) {
    case 'warning':
      return 'bg-warning/15 text-warning';
    case 'accent':
      return 'bg-accent/15 text-accent';
    case 'neutral':
      return 'bg-surface-2 text-ink-muted';
    case 'muted':
      return 'bg-surface-2 text-ink-extra-muted';
  }
}

export function formatPreviewSnippet(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<m-user-mention[^>]*\bname="([^"]+)"[^>]*\/?>/gi, '@$1')
    .replace(
      /<m-user-mention[^>]*>([\s\S]*?)<\/m-user-mention>/gi,
      (_match, inner: string) => {
        const trimmed = inner.trim();
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed) as {
              displayName?: string;
              name?: string;
              email?: string;
            };
            const label =
              parsed.displayName ?? parsed.name ?? parsed.email?.split('@')[0];
            if (label) return `@${label}`;
          } catch {
            // Fall through to plain-text handling
          }
          return '@mention';
        }
        return trimmed ? `@${trimmed.replace(/^@/, '')}` : '@mention';
      }
    )
    .replace(/<m-[a-z0-9-]+[^>]*>([\s\S]*?)<\/m-[a-z0-9-]+>/gi, '$1')
    .replace(/<m-[a-z0-9-]+\b[^>]*\/?>/gi, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function SidebarRow(props: SidebarRowProps) {
  const ws = useSidebarWorkspace();
  const [joining, setJoining] = createSignal(false);

  const selected = () => ws.selectedChannelId() === props.channel.id;
  const unread = () => ws.unreadIds().has(props.channel.id);
  const mentions = () => ws.mentionCounts().get(props.channel.id) ?? 0;
  const hasUnreadState = () => unread() || mentions() > 0;
  const muted = () => ws.mutedIds().has(props.channel.id);
  const hasActiveCall = () => ws.activeCallChannelIds().has(props.channel.id);
  const isUnjoined = () => !props.channel.isParticipant;
  const label = () => props.displayName ?? props.channel.name;
  const tooltipText = () =>
    props.displayName && props.displayName !== props.channel.name
      ? props.channel.name
      : props.channel.name.length > 26
        ? props.channel.name
        : undefined;

  const hoverAge = () => {
    if (props.ageLabel) return props.ageLabel;
    const ts =
      props.channel.latestMessage?.createdAtMs ?? props.channel.updatedAtMs;
    if (!ts) return '';
    return formatCompactAge(Math.max(0, Date.now() - ts));
  };

  // Drag & drop setup (fixed at mount per row kind; no-op when outside DragDropProvider).
  const dndCtx = useDragDropContext();
  const dragConfig = dndCtx ? props.drag : undefined;
  const dndScope =
    dragConfig?.kind === 'favorite'
      ? `${ws.railId}:redesign-favorites`
      : `${ws.railId}:redesign-channels`;

  const draggable = dragConfig
    ? createDraggable(
        `${dndScope}:drag:${props.rowId}`,
        dragConfig.kind === 'favorite'
          ? {
              dragType: 'redesign-favorite',
              dndScope,
              channelId: dragConfig.channelId,
              name: props.channel.name,
            }
          : {
              dragType: 'redesign-channel',
              dndScope,
              channelId: dragConfig.channelId,
              fromSectionId: dragConfig.fromSectionId,
              fromSectionScope: dragConfig.fromSectionScope,
              name: props.channel.name,
            }
      )
    : undefined;

  const favoriteDroppable =
    dragConfig?.kind === 'favorite'
      ? createDroppable(`${dndScope}:drop:${props.rowId}`, {
          dragType: 'redesign-favorite-target',
          dndScope,
          channelId: dragConfig.channelId,
        })
      : undefined;

  let didDrag = false;
  const [, dragActions] = dndCtx ?? [];
  if (dragConfig) {
    dragActions?.onDragStart(({ draggable: active }) => {
      if (
        active.data.dndScope === dndScope &&
        active.data.channelId === dragConfig.channelId
      ) {
        didDrag = true;
      }
    });
  }

  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0 || didDrag) return;
    if (props.onActivate) {
      props.onActivate(event);
      return;
    }
    ws.openChannel(props.channel.id, {
      newSplit: event.shiftKey,
      focusComposer: true,
    });
  };

  const handleMarkRead = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    fireAndForget(ws.markChannelsRead([props.channel.id]), 'channels-view');
  };

  const handleJoin = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (joining()) return;
    setJoining(true);
    fireAndForget(
      ws.joinChannel(props.channel.id).finally(() => setJoining(false)),
      'channels-view'
    );
  };

  const isCard = () => props.density === 'card';

  const nameElement = () => (
    <span
      class={cn(
        'min-w-0 flex-1 truncate text-sm leading-5',
        isUnjoined()
          ? 'text-ink-extra-muted'
          : hasUnreadState() && !muted()
            ? 'font-semibold text-ink'
            : selected()
              ? 'font-medium text-ink'
              : 'font-normal text-ink-muted group-hover/sidebar-row:text-ink'
      )}
    >
      {label()}
    </span>
  );

  const rowBody = (
    <div
      id={`${ws.railId}-${props.rowId}`}
      data-sidebar-row=""
      data-channel-id={props.channel.id}
      data-unread={hasUnreadState() ? 'true' : undefined}
      data-muted={muted() ? 'true' : undefined}
      role="treeitem"
      aria-selected={selected()}
      aria-current={selected() ? 'page' : undefined}
      tabIndex={-1}
      onPointerDown={(event) => {
        didDrag = false;
        if (event.pointerType === 'mouse' && event.button === 0) {
          ws.prefetchChannel(props.channel.id);
        }
      }}
      onClick={handleClick}
      class={cn(
        'group/sidebar-row relative flex min-w-0 select-none rounded-lg outline-none transition-colors',
        isCard() ? 'flex-col gap-1 px-2.5 py-2' : 'h-8 items-center gap-2 px-2',
        selected() && 'bg-active text-ink',
        !selected() && props.focused && 'bg-hover text-ink',
        !selected() && !props.focused && 'hover:bg-hover',
        muted() && !selected() && 'opacity-55 hover:opacity-85',
        props.urgent &&
          !selected() &&
          'border-l-2 border-warning pl-2 rounded-l-none'
      )}
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <span class="flex size-5 shrink-0 items-center justify-center">
          {ws.renderChannelIcon(props.channel, 'sm')}
        </span>

        <Show when={tooltipText()} fallback={nameElement()}>
          {(fullLabel) => (
            <Tooltip as="span" label={fullLabel()} class="min-w-0 flex-1 flex">
              {nameElement()}
            </Tooltip>
          )}
        </Show>

        <Show when={props.channel.isAgentDm && !props.badge && !isCard()}>
          <span
            class="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1 py-0.5 text-[10px] font-medium leading-none text-ink-muted"
            aria-label={t('channelSidebar.dmAgentBadge')}
          >
            <RobotIcon class="size-2.5" />
          </span>
        </Show>

        <Show when={props.showJoin && isUnjoined()}>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={joining()}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleJoin}
          >
            {t('channelSections.join')}
          </Button>
        </Show>

        <span class="flex shrink-0 items-center gap-1.5">
          {/* Quick 1-click mark read on hover for unread rows */}
          <Show when={hasUnreadState() && !isUnjoined()}>
            <Tooltip label={t('channelSidebar.focusMarkRead')} placement="top">
              <button
                type="button"
                aria-label={`${t('channelSidebar.focusMarkRead')} ${label()}`}
                data-mark-read-button=""
                class="hidden size-5 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink group-hover/sidebar-row:inline-flex group-focus-within/sidebar-row:inline-flex"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={handleMarkRead}
              >
                <CheckIcon class="size-3.5" />
              </button>
            </Tooltip>
          </Show>

          <Show when={hoverAge() && !isCard() && !hasActiveCall()}>
            <span class="hidden text-[11px] tabular-nums text-ink-extra-muted group-hover/sidebar-row:inline">
              {hoverAge()}
            </span>
          </Show>

          <Show when={props.ageLabel && isCard()}>
            <span class="text-[11px] tabular-nums text-ink-extra-muted">
              {props.ageLabel}
            </span>
          </Show>

          <Show when={muted()}>
            <BellSlashIcon
              aria-label="Muted"
              class="size-3.5 shrink-0 text-ink-extra-muted"
            />
          </Show>

          <Show when={hasActiveCall()}>
            <span
              aria-label="Active call"
              class="flex size-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
            >
              <PhoneIcon class="size-2.5" />
            </span>
          </Show>

          <Show when={!isUnjoined()}>
            <Switch>
              <Match when={mentions() > 0}>
                <span
                  aria-label={`${mentions()} mentions`}
                  class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-none tabular-nums text-accent-contrast"
                >
                  {mentions()}
                </span>
              </Match>
              <Match when={unread() && !muted()}>
                <span
                  aria-label="Unread"
                  class="mx-1 size-2 shrink-0 rounded-full bg-accent"
                />
              </Match>
              <Match when={unread() && muted()}>
                <span
                  aria-label="Unread (muted)"
                  class="mx-1 size-1.5 shrink-0 rounded-full bg-ink-extra-muted"
                />
              </Match>
            </Switch>
          </Show>

          {props.trailing}
        </span>
      </div>

      {/* Optional compact second line for triage cards (Focus & Support Desk) */}
      <Show when={isCard() && (props.badge || props.previewText)}>
        <div class="flex min-w-0 items-center gap-1.5 pl-7">
          <Show when={props.badge}>
            {(badge) => (
              <span
                class={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                  badgeToneClass(badge().tone)
                )}
              >
                {badge().label}
              </span>
            )}
          </Show>
          <Show when={formatPreviewSnippet(props.previewText)}>
            {(preview) => (
              <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                <Show when={props.senderPrefix}>
                  {(prefix) => (
                    <span class="font-medium text-ink-muted">{prefix()}: </span>
                  )}
                </Show>
                {preview()}
              </span>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );

  const wrappedRow = () =>
    ws.renderRowContextMenu
      ? ws.renderRowContextMenu(props.channel, rowBody)
      : rowBody;

  return (
    <div
      ref={(element) => {
        draggable?.ref(element);
        favoriteDroppable?.ref(element);
      }}
      {...(draggable ? draggable.dragActivators : {})}
      class={cn(
        'relative min-w-0',
        draggable?.isActiveDraggable && 'opacity-45'
      )}
    >
      {wrappedRow()}
      <Show when={props.dropEdge}>
        {(edge) => (
          <div
            aria-hidden="true"
            class={cn(
              'pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent',
              edge() === 'top' ? 'top-0' : 'bottom-0'
            )}
          />
        )}
      </Show>
    </div>
  );
}
