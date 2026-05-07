import type { NotificationType } from '@core/types';
import { DisplayName } from '@entity/components/DisplayName';
import { Show } from 'solid-js';
import { Entity } from '../../entity';
import { getActionVerb } from '../../extractors-notification/notification-description-helpers';
import type { EntityData } from '../../types/entity';
import type { Notification } from '../../types/notification';

export function TaskNarrowBody(props: {
  entity: EntityData;
  notification?: Notification;
}) {
  return (
    <Entity.Slot placement="body" class="flex flex-col pb-2 min-h-[2lh] pr-4 ">
      <Entity.Properties entity={props.entity} />
      <Show when={props.notification}>
        {(notif) => (
          <span class="text-ink-extra-muted font-normal truncate">
            <Show when={notif().sender_id}>
              {(senderId) => (
                <>
                  <DisplayName id={senderId()} format="firstName" />{' '}
                </>
              )}
            </Show>
            {getActionVerb(notif().notification_event_type as NotificationType)}
          </span>
        )}
      </Show>
    </Entity.Slot>
  );
}
