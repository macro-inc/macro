use crate::domain::{
    delivery::{DiscussionNotification, DiscussionNotifier},
    models::MessageParent,
    notification::CommentNotificationReason,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{
    CommentedOnDocumentMetadata, MentionedInDocumentCommentMetadata, NotificationDocumentSubType,
    RepliedToDocumentCommentThreadMetadata,
};
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};

/// Uses notification ingress with the existing document comment type names.
#[derive(Clone)]
pub struct MessageNotificationSender<N>(pub std::sync::Arc<N>);

impl<N: NotificationIngress> DiscussionNotifier for MessageNotificationSender<N> {
    async fn send(&self, n: DiscussionNotification<'_>) -> Result<(), rootcause::Report> {
        let sender_id = n.message.sender_id.as_user().cloned();
        let sender_display_name = n
            .message
            .bot_profile
            .as_ref()
            .map(|profile| profile.name.clone())
            .or_else(|| n.message.sender_id.as_bot().map(|_| "Agent".to_owned()));
        let recipient_ids =
            std::collections::HashSet::from([MacroUserIdStr::try_from(n.recipient)?]);
        let kind = match n.event.parent {
            MessageParent::Document(_) => EntityType::Document,
            MessageParent::Channel(_) => {
                return Err(rootcause::report!(
                    "comment notification requires discussion parent"
                ));
            }
        };
        let notification_entity = kind.with_entity_string(n.event.parent.entity_id());
        let secondary_notification_entity = None;
        macro_rules! send {
            ($metadata:expr) => {
                self.0
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity,
                            secondary_notification_entity,
                            notification: $metadata,
                            sender_id,
                            recipient_ids,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await?
            };
        }
        let owner = MacroUserIdStr::try_from(n.context.owner.clone())?;
        let sub_type = n
            .context
            .is_task
            .then_some(NotificationDocumentSubType::Task);
        match n.reason {
            CommentNotificationReason::Mention => {
                send!(MentionedInDocumentCommentMetadata {
                    sender_display_name: sender_display_name.clone(),
                    document_name: n.context.name.clone(),
                    owner,
                    file_type: n.context.file_type.clone(),
                    sub_type,
                    mention_id: n.message.id.to_string(),
                    comment_id: n.message.id,
                    thread_id: n.event.root_id,
                    text: n.message.content.clone(),
                    sender_profile_picture_url: n
                        .message
                        .bot_profile
                        .as_ref()
                        .and_then(|profile| profile.avatar_url.clone())
                        .or_else(|| n.context.sender_profile_picture.clone()),
                });
            }
            CommentNotificationReason::Reply => {
                send!(RepliedToDocumentCommentThreadMetadata {
                    sender_display_name: sender_display_name.clone(),
                    document_name: n.context.name.clone(),
                    owner,
                    file_type: n.context.file_type.clone(),
                    sub_type,
                    comment_id: n.message.id,
                    thread_id: n.event.root_id,
                    text: n.message.content.clone(),
                    sender_profile_picture_url: n
                        .message
                        .bot_profile
                        .as_ref()
                        .and_then(|profile| profile.avatar_url.clone())
                        .or_else(|| n.context.sender_profile_picture.clone()),
                });
            }
            _ => {
                send!(CommentedOnDocumentMetadata {
                    sender_display_name: sender_display_name.clone(),
                    document_name: n.context.name.clone(),
                    owner,
                    file_type: n.context.file_type.clone(),
                    sub_type,
                    comment_id: n.message.id,
                    thread_id: n.event.root_id,
                    text: n.message.content.clone(),
                    sender_profile_picture_url: n
                        .message
                        .bot_profile
                        .as_ref()
                        .and_then(|profile| profile.avatar_url.clone())
                        .or_else(|| n.context.sender_profile_picture.clone()),
                });
            }
        }
        Ok(())
    }
}
