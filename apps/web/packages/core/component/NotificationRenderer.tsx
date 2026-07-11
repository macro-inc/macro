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
  const time = () => formatDate(props.notification.created_at);
  const actorId = () => props.notification.sender_id ?? '';
  const macroId = () => tryMacroId(actorId());
  const [actorName] = useDisplayName(macroId(), {
    emailFallback: 'local-part',
  });
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
    const meta = props.notification.notification_metadata;
    if (meta.tag !== 'new_email') return null;
    return { subject: meta.content.subject, snippet: meta.content.snippet };
  };
  return (
    <Show when={props.notification.notification_metadata}>
      {(_metadata) => {
        if (props.mode === 'preview') {
          return (
            <div class="flex min-w-0 max-w-full items-baseline gap-[0.2em] overflow-hidden text-xs text-ink-muted font-medium font-sans">
              <span class="shrink-0 max-w-[8rem] truncate font-medium text-ink">
                {displayName()}
              </span>
              <span class="shrink-0 font-normal">{action()}</span>
              <Show when={showTarget() && isChannel() && entityId()}>
                <div class="min-w-0 flex-1 self-center max-h-lh overflow-hidden">
                  <InlineItemPreview id={entityId()} type="channel" />
                </div>
              </Show>
              <Show when={showTarget() && targetName() && !isChannel()}>
                <span class="min-w-0 flex-1 truncate font-medium text-ink">
                  {targetName()}
                </span>
              </Show>
              <span class="shrink-0 ml-auto text-ink-extra-muted font-mono uppercase font-normal">
                {time()}
              </span>
            </div>
          );
        }

        return (
          <>
            <div class="text-sm text-ink inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
              <span class="shrink-0 max-w-[10rem] truncate font-medium">
                {displayName()}
              </span>
              <span class="shrink-0">{action()}</span>
              <Show when={showTarget() && isChannel() && entityId()}>
                <span class="min-w-0 flex-1 overflow-hidden">
                  <InlineItemPreview id={entityId()} type="channel" />
                </span>
              </Show>
              <Show when={showTarget() && targetName() && !isChannel()}>
                <span class="min-w-0 flex-1 truncate font-medium">
                  {targetName()}
                </span>
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
