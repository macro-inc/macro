import type { UnifiedNotification } from '@notifications';
import type { NotificationEntityRef } from '@queries/notification/entity-mutations';
import type { MarkDoneWriteOutcome } from '../../utils';

export function notificationReceipt(
  id: string,
  entity: NotificationEntityRef
): UnifiedNotification {
  return {
    id,
    entity_id: entity.id,
    entity_type: entity.type === 'email' ? 'email_thread' : entity.type,
    notification_metadata: {
      tag: 'channel_message_send',
      content: { messageId: entity.id },
    },
  } as UnifiedNotification;
}

/** Fake write boundary for action tests; production reports each backend result. */
export type DoneWriteArgs = {
  emailIds: string[];
  notificationIds: string[];
  notificationEntities?: NotificationEntityRef[];
  onWriteSettled?: (outcome: MarkDoneWriteOutcome) => void;
};

export function reportDoneWriteOutcomes(
  args: DoneWriteArgs,
  result: PromiseSettledResult<string[]>
) {
  for (const id of args.emailIds)
    args.onWriteSettled?.({
      kind: 'email',
      id,
      result:
        result.status === 'fulfilled'
          ? { status: 'fulfilled', value: 'committed' }
          : result,
    });
  if (args.notificationIds.length > 0)
    args.onWriteSettled?.({
      kind: 'notifications',
      result:
        result.status === 'fulfilled'
          ? { status: 'fulfilled', value: args.notificationIds }
          : result,
    });
  if (args.notificationEntities?.length)
    args.onWriteSettled?.({
      kind: 'entity-notifications',
      result:
        result.status === 'fulfilled'
          ? {
              status: 'fulfilled',
              value: result.value.map((id, index) =>
                notificationReceipt(
                  id,
                  args.notificationEntities![
                    index % args.notificationEntities!.length
                  ]
                )
              ),
            }
          : result,
    });
}
