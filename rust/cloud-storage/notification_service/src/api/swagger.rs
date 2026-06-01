extern crate notification as notification_crate;

use crate::notification::send::push::PushNotificationData;
use model::{
    response::{EmptyResponse, ErrorResponse},
    version::NotificationServiceApiVersion,
};
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommentedOnDocumentMetadata, CommonChannelMetadata, DeviceType,
    DocumentMentionMetadata, GithubPrEvent, GithubPrEventAction, GithubPrEventStatus,
    InviteToTeamMetadata, ItemSharedMetadata, NewEmailMetadata,
    RepliedToDocumentCommentThreadMetadata, UserUnsubscribe,
};
use utoipa::OpenApi;

use crate::{
    api::{
        health,
        unsubscribe::{self, unsubscribe_item::UnsubscribeItemPathParams},
        user_notification,
    },
    model::notification::CreateNotification,
};

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /health
                health::health_handler,


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

                /// /user_notifications/preferences
                notification_crate::inbound::http::preferences::get_notification_type_preferences,
                notification_crate::inbound::http::preferences::disable_notification_type,
                notification_crate::inbound::http::preferences::enable_notification_type,

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
                        CreateNotification,
                        notification_crate::domain::models::device::DeviceRequest,
                        UnsubscribeItemPathParams,
                        UserUnsubscribe,
                        DeviceType,
                        PushNotificationData,
                        NewEmailMetadata,


                        // Metadata
                        CommonChannelMetadata,
                        ChannelInviteMetadata,
                        ChannelMessageSendMetadata,
                        ItemSharedMetadata,
                        InviteToTeamMetadata,
                        ChannelMentionMetadata,
                        ChannelReplyMetadata,
                        DocumentMentionMetadata,
                        RepliedToDocumentCommentThreadMetadata,
                        CommentedOnDocumentMetadata,
                        GithubPrEvent,
                        GithubPrEventStatus,
                        GithubPrEventAction,

                        // v2 typed notifications
                        model_notifications::NotifEvent,
                        user_notification::ApiUserNotification,
                        user_notification::GetAllUserNotificationsResponse,

                        // WebSocket notification payload
                        notification_crate::domain::models::queue_message::ConnGatewayNotificationPayload,
                        notification_crate::inbound::http::BulkGetByEventItemIdsRequest,
                        notification_crate::inbound::http::preferences::GetNotificationTypePreferencesResponse,
                ),
        ),
        tags(
            (name = "notification service", description = "Macro Notification Service")
        )
    )]
pub struct ApiDoc;
