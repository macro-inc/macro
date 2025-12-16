import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import type { SafeFetchInit } from '@core/util/safeFetch';
import { z } from 'zod';
import type {
  BulkGetUserNotificationsByEventItemIdRequest,
  GetAllUserNotificationsResponse,
  GetUserNotificationParams,
} from './generated/schemas';
import type { DeviceRequest } from './generated/schemas/deviceRequest';
import type { NotificationBulkRequest } from './generated/schemas/notificationBulkRequest';
import { NotificationServiceApiVersion } from './generated/schemas/notificationServiceApiVersion';
import type { UserNotification } from './generated/schemas/userNotification';
import type { UserUnsubscribe } from './generated/schemas/userUnsubscribe';

const notificationHost: string = SERVER_HOSTS['notification-service'];
// const notificationHost: string = 'http://localhost:8086';

export const NOTIFICATION_WEBSOCKET_EVENT = 'notification';
type NotificationEventType = typeof NOTIFICATION_WEBSOCKET_EVENT;

export type IncomingNotification = {
  type: NotificationEventType;
  data: string;
};
type WithEventItemId = { event_item_id: string };
type WithItem = { item_id: string; item_type: string };

export type UnifiedNotification = Omit<UserNotification, 'ownerId'> & {
  senderId?: string | null;
  // whether the notification is incoming on the websocket and needs processing
  // as opposed to coming from the database or an already processed notification
  new?: boolean;
};

const apiVersions = Object.values(
  NotificationServiceApiVersion
) satisfies string[];
const latestApiVersion = apiVersions[apiVersions.length - 1];

// NOTE: change this to the version you want to use, defaults to latest
const overrideApiVersion: string | undefined = undefined;

const apiVersion = overrideApiVersion ?? latestApiVersion;
console.log('Notification Service API version:', apiVersion);

export function notificationFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function notificationFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function notificationFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${notificationHost}/${apiVersion}${url}`, init);
}
export type Success = { success: boolean };

// message id is set by the notification service
export type ChannelMentionMetadata = z.infer<typeof channelMentionMetadata>;
export const channelMentionMetadata = z.object({
  message_id: z.string(),
});

// this metadata is provided by the front end
export type DocumentMentionMetadata = z.infer<typeof documentMentionMetadata>;
export type DocumentMentionLocation = NonNullable<
  DocumentMentionMetadata['location']
>;
export const documentMentionMetadata = z.object({
  mention_id: z.string(),
  location: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('create-comment'),
        commentId: z.number(),
        threadId: z.number(),
        text: z.string(),
      }),
      z.object({
        type: z.literal('edit-comment'),
        commentId: z.number(),
        threadId: z.number(),
        text: z.string(),
      }),
    ])
    .optional(),
});

export const notificationServiceClient = {
  async userNotifications(args: GetUserNotificationParams) {
    const { limit, cursor } = args;
    return mapOk(
      await notificationFetch<GetAllUserNotificationsResponse>(
        `/user_notifications?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        {
          method: 'GET',
        }
      ),
      (result) => {
        return result;
      }
    );
  },
  async bulkGetUserNotificationsByEventItemId(
    args: GetUserNotificationParams &
      BulkGetUserNotificationsByEventItemIdRequest
  ) {
    const { limit, cursor } = args;
    return mapOk(
      await notificationFetch<GetAllUserNotificationsResponse>(
        `/user_notifications/item/bulk?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventItemIds: args.eventItemIds }),
        }
      ),
      (result) => {
        return result;
      }
    );
  },
  async markNotificationAsSeen(args: NotificationBulkRequest) {
    const { notificationIds } = args;
    return mapOk(
      await notificationFetch<any>(`/user_notifications/bulk/seen`, {
        method: 'PATCH',
        body: JSON.stringify({ notificationIds }),
      }),
      (result) => result
    );
  },
  async markNotificationAsDone(args: NotificationBulkRequest) {
    const { notificationIds } = args;
    return mapOk(
      await notificationFetch<any>(`/user_notifications/bulk/done`, {
        method: 'PATCH',
        body: JSON.stringify({ notificationIds }),
      }),
      (result) => result
    );
  },
  async bulkMarkNotificationAsSeen(args: NotificationBulkRequest) {
    const { notificationIds } = args;
    return mapOk(
      await notificationFetch<any>(`/user_notifications/bulk/seen`, {
        method: 'PATCH',
        body: JSON.stringify({ notificationIds }),
      }),
      (result) => result
    );
  },
  async bulkMarkNotificationAsDone(args: NotificationBulkRequest) {
    const { notificationIds } = args;
    return mapOk(
      await notificationFetch<any>(`/user_notifications/bulk/done`, {
        method: 'PATCH',
        body: JSON.stringify({ notificationIds }),
      }),
      (result) => result
    );
  },
  async markNotificationEntityAsSeen(args: WithEventItemId) {
    const { event_item_id } = args;
    return mapOk(
      await notificationFetch<{}>(
        `/user_notifications/item/${event_item_id}/seen`,
        {
          method: 'PATCH',
        }
      ),
      (result) => result
    );
  },
  async markNotificationEntityAsDone(args: WithEventItemId) {
    const { event_item_id } = args;
    return mapOk(
      await notificationFetch<{}>(
        `/user_notifications/item/${event_item_id}/done`,
        {
          method: 'PATCH',
        }
      ),
      (result) => result
    );
  },
  async registerDevice(args: DeviceRequest) {
    return notificationFetch<{}>('/device/register', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  },
  async unregisterDevice(args: DeviceRequest) {
    return notificationFetch<{}>('/device/unregister', {
      method: 'DELETE',
      body: JSON.stringify(args),
    });
  },
  async getUnsubscribes() {
    return mapOk(
      await notificationFetch<UserUnsubscribe[]>('/unsubscribe', {
        method: 'GET',
      }),
      (result) => ({ data: result })
    );
  },
  async unsubscribeItem(args: WithItem) {
    return notificationFetch<{}>(
      `/unsubscribe/item/${args.item_type}/${args.item_id}`,
      {
        method: 'POST',
      }
    );
  },
  async removeUnsubscribeItem(args: WithItem) {
    return notificationFetch<{}>(
      `/unsubscribe/item/${args.item_type}/${args.item_id}`,
      {
        method: 'DELETE',
      }
    );
  },
};
