import { Show, For, createSignal } from 'solid-js';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import type { Notification } from '../types/notification';
import {
  type NotificationStack,
  type UnifiedNotification,
  openNotification,
} from '@notifications';
import { extractMessageContent } from '../utils/notification';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useNotificationActions } from './notification-actions';
import { Button } from '@ui/components/Button';
import CheckIcon from '@icon/regular/check.svg';
import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';

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
    // subType will be typed once orval regenerates the notification schemas
    const subTypeStr = (
      meta as { subType?: { type: string } | null } | undefined
    )?.subType?.type;
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
      class="group relative flex items-center gap-1.5 px-2 py-1 rounded border border-edge-muted bg-panel hover:bg-hover cursor-pointer text-xs min-w-0 max-w-48 flex-shrink-0"
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <EntityIcon targetType={targetType()} size="xs" />
      <span class="truncate min-w-0">{documentName()}</span>
      <Button
        class="absolute -top-2 -right-2 size-6 rounded-full bg-panel border border-edge-muted p-0 place-items-center hidden group-hover:grid hover:bg-accent! hover:text-panel!"
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

const MAX_VISIBLE_PILLS = 4;

function DocumentMentionPills(props: { stack: NotificationStack }) {
  const [expanded, setExpanded] = createSignal(false);
  const notifications = () => props.stack.notifications;
  const visible = () =>
    expanded() ? notifications() : notifications().slice(0, MAX_VISIBLE_PILLS);
  const overflow = () =>
    Math.max(0, notifications().length - MAX_VISIBLE_PILLS);

  return (
    <div class="flex flex-wrap items-center gap-1.5 pt-1">
      <For each={visible()}>
        {(n) => <DocumentMentionPill notification={n} />}
      </For>
      <Show when={!expanded() && overflow() > 0}>
        <button
          class="text-xs text-ink-muted border border-edge-muted rounded px-2 py-1 bg-panel hover:bg-edge/10 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          + {overflow()} more files
        </button>
      </Show>
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
