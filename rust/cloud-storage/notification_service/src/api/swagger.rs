extern crate notification as notification_crate;

use crate::notification::send::push::PushNotificationData;
use model::{
    response::{EmptyResponse, ErrorResponse},
    version::NotificationServiceApiVersion,
};
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DeviceType, DocumentMentionMetadata,
    InviteToTeamMetadata, ItemSharedMetadata, NewEmailMetadata, Notification, NotificationEvent,
    NotificationEventType, UserNotification, UserUnsubscribe,
};
use utoipa::OpenApi;

use crate::{
    api::{
        device, health, notification,
        unsubscribe::{self, unsubscribe_item::UnsubscribeItemPathParams},
        user_notification,
    },
    model::{device::DeviceRequest, notification::CreateNotification},
};

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /devices
                device::register::handler,
                device::unregister::handler,

                /// /health
                health::health_handler,

                /// /notifications
                notification::create_notification::handler,

                /// /user_notifications
                user_notification::list_typed_notifications,
                user_notification::bulk_get_typed_notifications_by_event_item_ids,
                user_notification::get_typed_by_event_item_id,
                user_notification::get_typed_notification_by_id,
                notification_crate::inbound::http::delete_notification,
                notification_crate::inbound::http::bulk_delete_notifications,
                notification_crate::inbound::http::bulk_mark_seen,
                notification_crate::inbound::http::bulk_mark_done,
                notification_crate::inbound::http::bulk_mark_undone,

                /// /unsubscribe
                unsubscribe::get_unsubscribes::handler,
                unsubscribe::unsubscribe_item::handler,
                unsubscribe::remove_unsubscribe_item::handler,
                unsubscribe::unsubscribe_email::handler,
                unsubscribe::remove_unsubscribe_all::handler,
                unsubscribe::unsubscribe_all::handler,
        ),
        components(
            schemas(
                        NotificationServiceApiVersion,
                        EmptyResponse,
                        ErrorResponse,
                        Notification,
                        CreateNotification,
                        UserNotification,
                        UnsubscribeItemPathParams,
                        UserUnsubscribe,
                        DeviceType,
                        DeviceRequest,
                        PushNotificationData,
                        NewEmailMetadata,

                        NotificationEvent,
                        NotificationEventType,

                        // Metadata
                        CommonChannelMetadata,
                        ChannelInviteMetadata,
                        ChannelMessageSendMetadata,
                        ItemSharedMetadata,
                        InviteToTeamMetadata,
                        ChannelMentionMetadata,
                        ChannelReplyMetadata,
                        DocumentMentionMetadata,

                        // v2 typed notifications
                        user_notification::NotifEvent,
                        user_notification::ApiUserNotification,
                        user_notification::GetAllUserNotificationsResponse,
                        notification_crate::inbound::http::BulkGetByEventItemIdsRequest,
                ),
        ),
        tags(
            (name = "notification service", description = "Macro Notification Service")
        )
    )]
pub struct ApiDoc;
