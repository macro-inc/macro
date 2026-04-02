//! Request and response models for the notification service.

use crate::domain::models::{
    ExclusionReason, FilteredRecipient, Notification, NotificationExtEmail, NotificationExtIos,
    RecipientExclusion, TaggedContent,
    apple::APNSPushNotification,
    mobile::{self, MessageAttributes},
    queue_message::EmailCreateBundle,
};
use cowlike::CowLike;
use itertools::Itertools;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

/// Request to send a notification.
///
/// Generic over the notification payload type `T`, which must implement
/// the `Notification` trait. The event type is derived from `T::TYPE_NAME`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendNotificationRequestBuilder<'a, T> {
    /// The entity associated with this notification (e.g., Channel, Team, Document).
    pub notification_entity: Entity<'a>,
    /// The notification payload (implements `Notification` trait).
    pub notification: T,
    /// The user who triggered this notification (optional).
    pub sender_id: Option<MacroUserIdStr<'a>>,
    /// The users who should receive this notification.
    pub recipient_ids: HashSet<MacroUserIdStr<'a>>,
}

impl<'a, T> SendNotificationRequestBuilder<'a, T>
where
    T: Notification,
{
    /// Convert this builder into a full request with optional delivery customizers.
    pub fn into_request(self) -> SendNotificationRequest<'a, T, ()> {
        let SendNotificationRequestBuilder {
            notification_entity,
            notification,
            sender_id,
            recipient_ids,
        } = self;
        SendNotificationRequest {
            uuid_to_write: Uuid::now_v7(),
            req: SendNotificationRequestBuilder {
                notification_entity,
                notification: TaggedContent::new(notification),
                sender_id,
                recipient_ids,
            },
            build_apns: None,
            build_email: None,
            send_conn_gateway: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct BuildApnsOutput<U> {
    pub(crate) notif: APNSPushNotification<U>,
    pub(crate) attr: MessageAttributes,
}

/// Full notification request with optional delivery channel builders.
///
/// Created from [`SendNotificationRequestBuilder::into_request`] and can be
/// customized with APNS and email builders.
#[derive(Serialize, Deserialize)]
pub struct SendNotificationRequest<'a, T, U> {
    pub(crate) req: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
    /// the uuid that will be written to db as PK
    pub(crate) uuid_to_write: Uuid,
    /// define how to turn t into an APNSPushNotitication T to be sent to ios
    pub(crate) build_apns: Option<BuildApnsOutput<U>>,
    /// define how to turn T into an email content to be sent as an email
    pub(crate) build_email: Option<EmailCreateBundle>,
    /// connection gateway accepts arbitrary json so we just ask if its enabled or not
    pub(crate) send_conn_gateway: bool,
}

impl<'a, T: NotificationExtIos, U> SendNotificationRequest<'a, T, U> {
    /// Add a custom APNS notification builder.
    pub fn with_apns(self) -> SendNotificationRequest<'a, T, T::NotifData> {
        let SendNotificationRequest {
            req,
            build_apns: _,
            build_email,
            uuid_to_write,
            send_conn_gateway,
        } = self;

        let sender = req.sender_id.clone().map(CowLike::into_owned);
        let entity = req.notification_entity.clone().into_owned();

        let collapse_key = req
            .notification
            .content
            .collapse_key(&entity)
            .into_hashed()
            .into_inner();
        let attrs = MessageAttributes {
            push_type: mobile::PushType::Alert,
            collapse_key,
        };
        let build_apns = req
            .notification
            .content
            .as_apns(sender.clone(), &entity, uuid_to_write)
            .map(|apns| BuildApnsOutput {
                notif: apns,
                attr: attrs,
            });

        SendNotificationRequest {
            req,
            uuid_to_write,
            build_apns,
            build_email,
            send_conn_gateway,
        }
    }
}

impl<'a, T: NotificationExtEmail, U> SendNotificationRequest<'a, T, U> {
    /// Add a custom email content builder.
    pub fn with_email(mut self) -> Self {
        self.build_email = Some(EmailCreateBundle::new(&self.req.notification.content));
        self
    }
}

impl<'a, T: Notification, U> SendNotificationRequest<'a, T, U> {
    /// Enable delivery via connection gateway (WebSocket).
    pub fn with_conn_gateway(mut self) -> Self {
        self.send_conn_gateway = true;
        self
    }
}

impl<'a, T, U> SendNotificationRequest<'a, T, U> {
    pub(crate) fn update_recipients(
        mut self,
        muted_users: HashSet<MacroUserIdStr<'a>>,
        unsubscribed_users: HashSet<MacroUserIdStr<'a>>,
        type_disabled_users: HashSet<MacroUserIdStr<'a>>,
    ) -> (Self, Vec<RecipientExclusion<'a>>) {
        let recipient_is_sender = |id: FilteredRecipient<'a>| match (id, &self.req.sender_id) {
            (FilteredRecipient::Allowed(macro_user_id_str), Some(sender))
                if sender == &macro_user_id_str =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::IsSender,
                })
            }
            (x, _) => x,
        };

        let user_muted_notifs = |id: FilteredRecipient<'a>| match id {
            FilteredRecipient::Allowed(macro_user_id_str)
                if muted_users.contains(&macro_user_id_str) =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::MutedNotifications,
                })
            }
            x => x,
        };

        let notif_type_is_ignored = |id: FilteredRecipient<'a>| match id {
            FilteredRecipient::Allowed(macro_user_id_str)
                if unsubscribed_users.contains(&macro_user_id_str) =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::UnsubscribedFromItem,
                })
            }
            x => x,
        };

        let user_disabled_type = |id: FilteredRecipient<'a>| match id {
            FilteredRecipient::Allowed(macro_user_id_str)
                if type_disabled_users.contains(&macro_user_id_str) =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::DisabledNotificationType,
                })
            }
            x => x,
        };

        let recipients = std::mem::take(&mut self.req.recipient_ids);

        let (allowed, excluded): (HashSet<_>, Vec<_>) = recipients
            .into_iter()
            .map(FilteredRecipient::Allowed)
            .map(recipient_is_sender)
            .map(user_muted_notifs)
            .map(notif_type_is_ignored)
            .map(user_disabled_type)
            .partition_map(|r| match r {
                FilteredRecipient::Allowed(a) => itertools::Either::Left(a),
                FilteredRecipient::Excluded(b) => itertools::Either::Right(b),
            });

        self.req.recipient_ids = allowed;

        (self, excluded)
    }
}

impl<'a, T: Notification> SendNotificationRequestBuilder<'a, T> {
    /// Get the event type name from the notification.
    pub fn event_type(&self) -> &'static str {
        T::TYPE_NAME
    }
}

/// Result of sending a notification.
#[derive(Debug, Clone)]
pub struct NotificationResult<'a> {
    /// The unique ID of the created notification.
    pub notification_id: Uuid,
    /// The users who were actually notified (after filtering).
    pub notified_recipients: HashSet<MacroUserIdStr<'a>>,
}

/// the status the user is requesting to set on the notification
#[derive(Debug)]
pub enum NotificationStatus {
    /// the notification has been seen
    Seen,
    /// the notification is either done or _not_ done
    Done(bool),
}

impl NotificationStatus {
    /// returns true if we should be clearing the relevant push notifications
    /// for this notification
    pub(crate) fn should_clear_push_notifs(&self) -> bool {
        match self {
            NotificationStatus::Seen => true,
            NotificationStatus::Done(x) => *x,
        }
    }
}

/// Request to update the status of one or more notifications for a user.
#[derive(Debug)]
pub struct UpdateNotificationsRequest<'a> {
    /// The user whose notifications are being updated.
    pub user_id: MacroUserIdStr<'a>,
    /// The notification IDs to update.
    pub notification_ids: &'a [Uuid],
    /// The status to set on the notifications.
    pub status: NotificationStatus,
}

/// Request to get a user's notifications filtered by event item IDs.
#[derive(Debug)]
pub struct GetNotificationsByEventItemIdsRequest<'a> {
    /// The user whose notifications to retrieve.
    pub user_id: MacroUserIdStr<'a>,
    /// The event item IDs to filter by.
    pub event_item_ids: &'a [Uuid],
    /// Maximum number of results per page (default 20, max 500).
    pub limit: Option<u32>,
    /// Cursor for pagination.
    pub cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
}
