//! Native discovery, activity and notifications without publishing agent triggers.

use activity::domain::{
    materializer::ActivityMaterializer,
    ports::{ActivityRealtimePublisher, ActivityRepo},
};
use async_trait::async_trait;
use channels::domain::models::{ChannelInfo, ChannelType};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    events::MessagePostedMetadata,
    ports::{MessageChange, MessageEvent},
};
use meta_messaging::{
    domain::{events::Direction, models::Provenance, ports::PortResult},
    outbound::repository::native::NativeEffect,
};
use model_entity::EntityType;
use model_notifications::{ChannelMessageSendMetadata, CommonChannelMetadata};
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use soup_realtime::domain::{
    models::{Patch, SoupRealtimePatch},
    ports::SoupRealtimeService,
};
use std::collections::HashSet;

use super::native::error;

#[cfg(test)]
mod test;

/// The composition seam keeps native effects testable without network transports.
#[async_trait]
pub(super) trait NativeMessageEffects: Send + Sync {
    async fn publish(
        &self,
        effect: &NativeEffect,
        event: &MessageEvent,
        channel: &ChannelInfo,
        viewers: &HashSet<String>,
    ) -> PortResult<()>;
}

pub(super) struct NativeEffects<S, R, A, N> {
    pub soup: S,
    pub activity: ActivityMaterializer<R, A>,
    pub notifications: N,
}

#[async_trait]
impl<S, R, A, N> NativeMessageEffects for NativeEffects<S, R, A, N>
where
    S: SoupRealtimeService,
    R: ActivityRepo + Send + Sync,
    A: ActivityRealtimePublisher,
    N: NotificationIngress,
{
    async fn publish(
        &self,
        effect: &NativeEffect,
        event: &MessageEvent,
        channel: &ChannelInfo,
        viewers: &HashSet<String>,
    ) -> PortResult<()> {
        let message = match &event.change {
            MessageChange::Posted { message, .. } | MessageChange::Edited { message, .. } => {
                message
            }
            _ => return Ok(()),
        };
        if effect.first_publication
            && effect.provenance != Provenance::OnboardingHistory
            && message.deleted_at.is_none()
        {
            // Use the owning domain's activity mapping and stable source identity.
            // Retry inserts/announcements retain one activity, even after a crash.
            self.activity
                .apply(channels::domain::activity::ingest_message_event(
                    message.id,
                    &messages::outbound::broker::MessageTopicEvent::Posted(
                        MessagePostedMetadata::from_message(message, vec![]),
                    ),
                ))
                .await
                .map_err(error)?;
            if effect.provenance == Provenance::Customer && effect.direction == Direction::Inbound {
                let recipients = viewers
                    .iter()
                    .map(|viewer| MacroUserIdStr::try_from(viewer.clone()).map_err(error))
                    .collect::<PortResult<HashSet<_>>>()?;
                if !recipients.is_empty() {
                    self.notifications
                        .send_notification(
                            SendNotificationRequestBuilder {
                                notification_entity: EntityType::Channel
                                    .with_entity_string(channel.id.to_string()),
                                secondary_notification_entity: None,
                                notification: ChannelMessageSendMetadata {
                                    message_id: message.id.to_string(),
                                    sender: None,
                                    sender_display_name: message
                                        .imported_author
                                        .as_ref()
                                        .map(|author| author.name.clone()),
                                    message_content: message.content.clone(),
                                    has_attachments: !message.attachments.is_empty(),
                                    common: CommonChannelMetadata {
                                        channel_type: match channel.channel_type {
                                            ChannelType::Private => {
                                                model_notifications::ChannelType::Private
                                            }
                                            ChannelType::Team => {
                                                model_notifications::ChannelType::Team
                                            }
                                            ChannelType::Public => {
                                                model_notifications::ChannelType::Public
                                            }
                                            ChannelType::DirectMessage => {
                                                model_notifications::ChannelType::DirectMessage
                                            }
                                        },
                                        channel_name: channel.name.clone().unwrap_or_default(),
                                    },
                                    sender_profile_picture_url: None,
                                },
                                sender_id: None,
                                recipient_ids: recipients,
                            }
                            .into_request_with_id(message.id)
                            .with_apns()
                            .with_conn_gateway(),
                        )
                        .await
                        .map_err(error)?;
                }
            }
        }

        // The same native stream serves normal navigation and thread lists.
        // Imports update these lists too, without becoming fresh notifications.
        let parent = EntityType::Channel.with_entity_string(channel.id.to_string());
        self.soup
            .notify_users(SoupRealtimePatch::for_entity(Patch::Updated(
                parent.clone(),
            )))
            .await
            .map_err(error)?;
        self.soup
            .notify_users(SoupRealtimePatch::new(
                Patch::Updated(
                    EntityType::ChannelMessage.with_entity_string(message.root_id().to_string()),
                ),
                parent,
            ))
            .await
            .map_err(error)?;
        Ok(())
    }
}
