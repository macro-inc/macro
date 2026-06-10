//! Connection-gateway realtime adapter for channel side effects.

#[cfg(test)]
mod test;

use crate::domain::{
    models::{
        BotSenderProfile, CountedReaction, MutatedAttachment, MutatedMessage, Sender, TypingAction,
    },
    ports::ChannelRealtimePublisher,
    side_effects::ChannelRealtimeEffect,
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType as GatewayEntityType;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

/// Connection-gateway realtime publisher adapter.
#[derive(Clone)]
pub struct ConnectionGatewayChannelRealtimePublisher {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayChannelRealtimePublisher {
    /// Create a realtime publisher adapter.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }

    async fn send_update<T: Serialize + Send>(
        &self,
        message_type: &'static str,
        payload: T,
        participants: Vec<MacroUserIdStr<'static>>,
    ) -> anyhow::Result<()> {
        if participants.is_empty() {
            return Ok(());
        }
        self.client
            .batch_send_message(
                message_type.to_string(),
                serde_json::to_value(payload)?,
                participants
                    .iter()
                    .map(|p| GatewayEntityType::User.with_entity_str(p.as_ref()))
                    .collect(),
            )
            .await?;
        Ok(())
    }
}

impl ChannelRealtimePublisher for ConnectionGatewayChannelRealtimePublisher {
    type Err = anyhow::Error;

    async fn publish(&self, effect: ChannelRealtimeEffect) -> Result<(), Self::Err> {
        match effect {
            ChannelRealtimeEffect::Message {
                recipients,
                message,
                bot_profile,
                nonce,
            } => {
                let sender = MessageRealtimeSender::new(&message.sender_id, bot_profile);
                self.send_update(
                    "comms_message",
                    WithNonce {
                        data: MessageRealtimeData { message, sender },
                        nonce,
                    },
                    recipients,
                )
                .await
            }
            ChannelRealtimeEffect::Attachments {
                recipients,
                channel_id,
                message_id,
                attachments,
                nonce,
            } => {
                self.send_update(
                    "comms_attachment",
                    WithNonce {
                        data: AttachmentRealtimeData {
                            channel_id,
                            message_id,
                            attachments,
                        },
                        nonce,
                    },
                    recipients,
                )
                .await
            }
            ChannelRealtimeEffect::Reaction {
                recipients,
                channel_id,
                message_id,
                reactions,
                nonce,
            } => {
                self.send_update(
                    "comms_reaction",
                    WithNonce {
                        data: ReactionRealtimeData {
                            channel_id,
                            message_id,
                            reactions,
                        },
                        nonce,
                    },
                    recipients,
                )
                .await
            }
            ChannelRealtimeEffect::Typing {
                recipients,
                channel_id,
                user_id,
                action,
                thread_id,
                nonce,
            } => {
                self.send_update(
                    "comms_typing",
                    WithNonce {
                        data: TypingRealtimeData {
                            channel_id,
                            user_id,
                            action,
                            thread_id,
                        },
                        nonce,
                    },
                    recipients,
                )
                .await
            }
        }
    }
}

#[derive(Serialize)]
struct WithNonce<T: Serialize> {
    #[serde(flatten)]
    data: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce: Option<String>,
}

#[derive(Serialize)]
struct MessageRealtimeData {
    #[serde(flatten)]
    message: MutatedMessage,
    /// Structured sender identity, shaped like the REST `ApiMessageSender`.
    sender: MessageRealtimeSender,
}

#[derive(Serialize)]
struct MessageRealtimeSender {
    #[serde(rename = "type")]
    sender_type: &'static str,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
}

impl MessageRealtimeSender {
    fn new(sender: &Sender, bot_profile: Option<BotSenderProfile>) -> Self {
        match sender {
            Sender::Bot(bot_id) => Self {
                sender_type: "bot",
                id: bot_id.as_uuid().to_string(),
                name: bot_profile.as_ref().map(|profile| profile.name.clone()),
                avatar_url: bot_profile.and_then(|profile| profile.avatar_url),
            },
            Sender::User(user_id) => Self {
                sender_type: "user",
                id: user_id.as_ref().to_string(),
                name: None,
                avatar_url: None,
            },
        }
    }
}

#[derive(Serialize)]
struct AttachmentRealtimeData {
    channel_id: Uuid,
    message_id: Uuid,
    attachments: Vec<MutatedAttachment>,
}

#[derive(Serialize)]
struct ReactionRealtimeData {
    channel_id: Uuid,
    message_id: Uuid,
    reactions: Vec<CountedReaction>,
}

#[derive(Serialize)]
struct TypingRealtimeData {
    channel_id: Uuid,
    user_id: String,
    action: TypingAction,
    thread_id: Option<Uuid>,
}
