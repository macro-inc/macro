import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EntityIcon } from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import CheckIcon from '@icon/regular/check.svg';
import {
  type NotificationStack,
  openNotification,
  type UnifiedNotification,
} from '@notifications';
import { Button } from '@ui';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Notification } from '../types/notification';
import { extractMessageContent } from '../utils/notification';
import { useNotificationActions } from './notification-actions';

interface NotificationContentProps {
  notification?: Notification;
  stack?: NotificationStack;
  singleLine?: boolean;
}

function DocumentMentionPill(props: { notification: UnifiedNotification }) {
  const notificationSource = useGlobalNotificationSource();
  const { markAsDone } = useNotificationActions({
    notification: props.notification,
  });

  const documentMeta = () => {
    const m = props.notification.notification_metadata;
    return m.tag === 'document_mention' ? m.content : undefined;
  };
  const documentName = () => documentMeta()?.documentName ?? 'Untitled';
  const targetType = () => {
    const meta = documentMeta();

    const subTypeStr = meta?.subType?.type;
    return fileTypeToBlockName(subTypeStr ?? meta?.fileType) ?? 'default';
  };

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    await openNotification(props.notification, splitManager, e.shiftKey);
    await notificationSource.markAsRead(props.notification);
  };

  return (
    <div
      class="group relative flex items-center gap-1.5 px-2 py-1 rounded-md bg-ink-muted/[0.06] hover:bg-ink-muted/10 text-xs text-ink-muted min-w-0 max-w-48 shrink-0"
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <EntityIcon targetType={targetType()} size="xs" />
      <span class="truncate min-w-0">{documentName()}</span>
      <Button
        class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface border border-edge-muted/50 p-0 place-items-center hidden group-hover:grid hover:bg-accent! hover:text-surface!"
        tooltip="Mark as done"
        onClick={(e) => {
          e.stopPropagation();
          markAsDone();
        }}
      >
        <CheckIcon class="size-2.5" />
      </Button>
    </div>
  );
}

function DocumentMentionPills(props: { stack: NotificationStack }) {
  let measureRef: HTMLDivElement | undefined;
  let badgeRef: HTMLButtonElement | undefined;
  // null = not yet measured; show all pills until the first measurement completes.
  const [visibleCount, setVisibleCount] = createSignal<number | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const notifications = () => props.stack.notifications;

  const recalculate = () => {
    const container = measureRef;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth === 0) return;

    const gap = 6; // gap-1.5 = 6px
    // Direct children are the pills; the badge button is excluded via data-badge.
    const pills = Array.from(container.children).filter(
      (el) => !el.hasAttribute('data-badge')
    ) as HTMLElement[];
    if (pills.length === 0) return;

    const pillWidths = pills.map((el) => el.getBoundingClientRect().width);
    const badgeWidth = badgeRef
      ? badgeRef.getBoundingClientRect().width + gap
      : 0;

    // Check whether every pill fits with no badge needed.
    const totalWidth = pillWidths.reduce(
      (sum, w, i) => sum + w + (i > 0 ? gap : 0),
      0
    );
    if (totalWidth <= containerWidth) {
      setVisibleCount(pills.length);
      return;
    }

    // Some pills overflow — fit as many as possible while leaving room for the badge.
    const availableWidth = containerWidth - badgeWidth;
    let usedWidth = 0;
    let count = 0;
    for (let i = 0; i < pillWidths.length; i++) {
      const addWidth = (i > 0 ? gap : 0) + pillWidths[i];
      if (usedWidth + addWidth <= availableWidth) {
        usedWidth += addWidth;
        count++;
      } else {
        break;
      }
    }
    setVisibleCount(Math.max(1, count));
  };

  // Re-measure when notifications change or on first mount.
  createEffect(() => {
    void notifications();
    recalculate();
  });

  // Re-measure whenever the container is resized (window resize, panel resize, etc.).
  createEffect(() => {
    const container = measureRef;
    if (!container) return;
    const observer = new ResizeObserver(recalculate);
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });

  const count = () =>
    expanded()
      ? notifications().length
      : (visibleCount() ?? notifications().length);
  const overflow = () => Math.max(0, notifications().length - count());

  return (
    <div class="relative pt-1">
      {/*
			  Invisible measurement layer: absolutely positioned so it takes no layout
			  space, but always contains every pill + the badge so their widths can be
			  measured at any point regardless of what the visible layer shows.
			*/}
      <div
        ref={measureRef}
        class="absolute inset-x-0 top-0 flex flex-nowrap items-center gap-1.5 invisible pointer-events-none"
        aria-hidden="true"
      >
        <For each={notifications()}>
          {(n) => <DocumentMentionPill notification={n} />}
        </For>
        <button
          ref={badgeRef}
          data-badge
          class="text-xs text-ink-muted border border-edge-muted/50 rounded-md px-2 py-1 shrink-0"
          tabIndex={-1}
        >
          +{notifications().length} more
        </button>
      </div>
      {/* Visible layer: only as many pills as fit, followed by the badge if needed. */}
      <div
        class={
          expanded()
            ? 'flex flex-wrap items-center gap-1.5'
            : 'flex flex-nowrap items-center gap-1.5'
        }
      >
        <For each={notifications().slice(0, count())}>
          {(n) => <DocumentMentionPill notification={n} />}
        </For>
        <Show when={overflow() > 0}>
          <button
            class="text-xs text-ink-muted border border-edge-muted/50 rounded-md px-2 py-1 bg-surface hover:bg-hover shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            +{overflow()} more
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Displays the content/preview of a notification
 * For single notifications, shows the message content
 * For stacks, shows the most recent notification's content
 * For document_mention stacks, shows pills for each mentioned document
 */
export function NotificationContent(props: NotificationContentProps) {
  const content = () => {
    if (props.notification) {
      return extractMessageContent(props.notification);
    }
    if (props.stack && props.stack.notifications.length > 0) {
      return extractMessageContent(props.stack.notifications[0]);
    }
    return '';
  };

  return (
    <Show
      when={props.stack?.type === 'document_mention'}
      fallback={
        <Show when={content()}>
          {(text) => (
            <Show
              when={text().trim()}
              fallback={
                <span class="italic text-ink-disabled">Attached items</span>
              }
            >
              {(trimmedContent) => (
                <StaticMarkdown
                  markdown={trimmedContent()}
                  theme={unifiedListMarkdownTheme}
                  singleLine={props.singleLine ?? true}
                />
              )}
            </Show>
          )}
        </Show>
      }
    >
      <DocumentMentionPills stack={props.stack!} />
    </Show>
  );
}
