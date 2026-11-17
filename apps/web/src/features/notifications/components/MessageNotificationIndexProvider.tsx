import { useOptionalGlobalNotificationSource } from '@components/app/GlobalAppState';
import { indexUnreadMessageNotifications } from '@notifications/unread-message-notifications';
import { useEntityUnseenNotifications } from '@queries/notification/graphql/entity-unseen-notifications';
import type { SoupEntityRef } from '@queries/soup/graphql/entity-input';
import type { MessageParent } from '@service-storage/messages';
import { createMemo, type JSXElement, untrack, useContext } from 'solid-js';
import { MessageNotificationIndexContext } from './MarkMessageNotifications';

/**
 * The Soup entity whose own edge holds a parent's notifications. The
 * single-entity input has no CRM contacts.
 */
const PARENT_ENTITY_TYPES: Record<
  MessageParent['type'],
  SoupEntityRef['entityType'] | undefined
> = {
  channel: 'CHANNEL',
  document: 'DOCUMENT',
  initiative: 'INITIATIVE',
  crm_company: 'COMPANY',
  crm_contact: undefined,
  call: 'CALL_RECORD',
};

/**
 * Indexes a thread's unread message notifications from one live read of its
 * parent, so its messages never load the notification feed. For parents no
 * Soup read returns, each message still reads the feed. An index an enclosing
 * view already provides, such as a channel's, stays in use.
 */
export function MessageNotificationIndexProvider(props: {
  parent: MessageParent;
  children: JSXElement;
}) {
  const notificationSource = useOptionalGlobalNotificationSource();
  if (!notificationSource || useContext(MessageNotificationIndexContext))
    return props.children;
  const entity = createMemo(
    () => {
      const entityType = PARENT_ENTITY_TYPES[props.parent.type];
      if (!entityType) return undefined;
      return { entityType, entityId: props.parent.id };
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.entityType === next?.entityType &&
        previous?.entityId === next?.entityId,
    }
  );
  const unseen = createMemo(() => {
    const target = entity();
    if (!target) return undefined;
    return untrack(() =>
      useEntityUnseenNotifications(
        target.entityType,
        target.entityId,
        notificationSource.isEnabled
      )
    );
  });
  const index = createMemo(() => {
    const notifications = unseen();
    if (!notifications) return undefined;
    const parent = props.parent;
    const withLocalOverrides = notificationSource.withLocalOverrides;
    return indexUnreadMessageNotifications(
      notifications()
        // The edge also holds notifications that only reference the parent;
        // the feed files those under their own entity.
        .filter(
          (notification) =>
            notification.entity_type === parent.type &&
            notification.entity_id === parent.id
        )
        .map((notification) =>
          withLocalOverrides ? withLocalOverrides(notification) : notification
        )
    );
  });
  return (
    <MessageNotificationIndexContext.Provider value={index}>
      {props.children}
    </MessageNotificationIndexContext.Provider>
  );
}
