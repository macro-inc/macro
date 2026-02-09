import { InlineItemPreview } from '@core/component/ItemPreview';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import { formatDate } from '@core/util/date';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  shouldShowNotificationTarget,
  type UnifiedNotification,
} from '@notifications';
import { Show } from 'solid-js';

type NotificationRendererProps = {
  notification: UnifiedNotification;
  mode: 'preview' | 'full';
};

export function NotificationRenderer(props: NotificationRendererProps) {
  const time = () => formatDate(props.notification.createdAt);
  const actorId = () => props.notification.senderId ?? '';
  const macroId = () => tryMacroId(actorId());
  const [actorName] = useDisplayName(macroId());
  const emailFallback = () => {
    const mid = macroId();
    return mid ? macroIdToEmail(mid) : actorId() || undefined;
  };
  const displayName = () => actorName() || emailFallback() || 'Someone';

  const action = () => getNotificationAction(props.notification);
  const targetName = () => getNotificationTargetName(props.notification);
  const content = () => getNotificationContent(props.notification);
  const showTarget = () => shouldShowNotificationTarget(props.notification);
  const isChannel = () => props.notification.entity_type === 'channel';
  const entityId = () => props.notification.entity_id;

  const emailMeta = () => {
    const meta = props.notification.notificationMetadata;
    if (meta.tag !== 'new_email') return null;
    return { subject: meta.content.subject, snippet: meta.content.snippet };
  };

  return (
    <Show when={props.notification.notificationMetadata}>
      {(_metadata) => {
        if (props.mode === 'preview') {
          return (
            <div class="truncate flex items-baseline gap-[0.2em] text-xs text-ink-muted font-medium font-sans">
              <span class="font-medium text-ink">{displayName()}</span>
              <span class="font-normal">{action()}</span>
              <Show when={showTarget() && isChannel() && entityId()}>
                <div class="self-center max-h-[1lh]">
                  <InlineItemPreview id={entityId()} type="channel" />
                </div>
              </Show>
              <Show when={showTarget() && targetName() && !isChannel()}>
                <span class="font-medium text-ink">{targetName()}</span>
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
              <span class="font-medium">{displayName()}</span> {action()}{' '}
              <Show when={showTarget() && isChannel() && entityId()}>
                <InlineItemPreview id={entityId()} type="channel" />
              </Show>
              <Show when={showTarget() && targetName() && !isChannel()}>
                <span class="font-medium">{targetName()}</span>
              </Show>
            </div>

            <Show when={content()}>
              <div class="text-xs text-ink-muted">
                <StaticMarkdown markdown={content() || ''} />
              </div>
            </Show>

            <Show when={emailMeta()}>
              {(meta) => (
                <div class="text-xs text-ink-muted">
                  {meta().subject} - {meta().snippet}
                </div>
              )}
            </Show>
          </>
        );
      }}
    </Show>
  );
}
