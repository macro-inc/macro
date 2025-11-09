import { InlineItemPreview } from '@core/component/ItemPreview';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useDisplayName } from '@core/user/displayName';
import { formatDate } from '@core/util/date';
import { notificationWithMetadata } from '@notifications/notificationMetadata';
import { extractNotificationData } from '@notifications/notificationPreview';
import type { UnifiedNotification } from '@notifications/types';
import { Show } from 'solid-js';

type NotificationRendererProps = {
  notification: UnifiedNotification;
  mode: 'preview' | 'full';
};

export function NotificationRenderer(props: NotificationRendererProps) {
  const typed = () => notificationWithMetadata(props.notification);
  const data = () => {
    const t = typed();
    if (!t) return null;
    const result = extractNotificationData(t);
    if (result === 'no_extractor' || result === 'no_extracted_data') {
      return null;
    }
    return result;
  };

  const time = () => formatDate(props.notification.createdAt);

  return (
    <Show when={data()}>
      {(d) => {
        const actorId = d().actor?.id ?? '';
        const [actorName] = useDisplayName(actorId);

        const displayName = () => actorName() || 'Someone';

        if (props.mode === 'preview') {
          return (
            <div class="truncate flex items-baseline gap-[0.2em] text-xs text-ink-muted font-medium font-sans">
              <span class="font-medium text-ink">{displayName()}</span>
              <span class="font-normal">{d().action}</span>
              <Show when={d().target?.type === 'channel' && d().target?.id}>
                <div class="self-center max-h-[1lh]">
                  <InlineItemPreview
                    itemId={d().target!.id!}
                    itemType="channel"
                  />
                </div>
              </Show>
              <Show when={d().target?.name && d().target?.type !== 'channel'}>
                <span class="font-medium text-ink">{d().target!.name}</span>
              </Show>
              <span class="text-ink-extra-muted ml-2 font-mono uppercase font-normal">
                {time()}
              </span>
            </div>
          );
        }

        return (
          <>
            <div class="text-sm text-ink inline-flex items-center gap-1">
              <span class="font-medium">{displayName()}</span> {d().action}{' '}
              <Show when={d().target?.type === 'channel' && d().target?.id}>
                <InlineItemPreview
                  itemId={d().target!.id!}
                  itemType="channel"
                />
              </Show>
              <Show when={d().target?.name && d().target?.type !== 'channel'}>
                <span class="font-medium">{d().target!.name}</span>
              </Show>
            </div>

            <Show when={d().content}>
              <div class="text-xs text-ink-muted">
                <StaticMarkdown markdown={d().content || ''} />
              </div>
            </Show>

            <Show when={d().meta?.permissionLevel}>
              <div class="text-xs text-ink-muted">
                You now have {d().meta!.permissionLevel} access
              </div>
            </Show>

            <Show when={d().meta?.snippet}>
              <div class="text-xs text-ink-muted">
                {d().meta!.subject} - {d().meta!.snippet}
              </div>
            </Show>
          </>
        );
      }}
    </Show>
  );
}
