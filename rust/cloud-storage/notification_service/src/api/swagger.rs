use model::{
    response::{EmptyResponse, ErrorResponse},
    version::NotificationServiceApiVersion,
};
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DeviceType, DocumentMentionMetadata,
    InviteToTeamMetadata, ItemSharedMetadata, NewEmailMetadata, Notification, NotificationEvent,
    NotificationEventType, PushNotificationData, UserNotification, UserUnsubscribe,
};
use utoipa::OpenApi;

use crate::{
    api::{
        device, health, notification,
        unsubscribe::{self, unsubscribe_item::UnsubscribeItemPathParams},
        user_notification::{self, get_user_notification::GetAllUserNotificationsResponse},
    },
    model::{
        device::DeviceRequest, notification::CreateNotification,
        user_notification::NotificationBulkRequest,
    },
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
                user_notification::get_user_notification::handler,
                user_notification::delete_user_notification::handler,
                user_notification::bulk_mark_user_notification_seen_by_event::handler,
                user_notification::bulk_mark_user_notification_done_by_event::handler,
                user_notification::bulk_delete_user_notification::handler,
                user_notification::bulk_mark_user_notification_seen::handler,
                user_notification::bulk_mark_user_notification_done::handler,
                user_notification::get_user_notifications_by_event_item_id::handler,
                user_notification::bulk_get_user_notifications_by_event_item_id::handler,

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
                        GetAllUserNotificationsResponse,
                        NotificationBulkRequest,
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
                ),
        ),
        tags(
            (name = "notification service", description = "Macro Notification Service")
        )
    )]
pub struct ApiDoc;
