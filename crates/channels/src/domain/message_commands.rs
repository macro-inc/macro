//! Channel request translation into the shared message command boundary.
use super::{
    models::{
        DeleteMessageQuery, PatchMessageRequest, PostMessageRequest, PostMessageResponse,
        PostReactionRequest, ReactionAction,
    },
    ports::{ChannelMessageCommands, ChannelMutationErr},
};
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use messages::domain::{
    api::MessageCommands,
    models::PostMessage,
    ports::{AttachmentChange, MessageError, MessagePatch},
    service::MessageWrite,
};
use std::sync::Arc;
use uuid::Uuid;

/// Adapter for existing channel message endpoints, with a required command dependency.
#[derive(Clone)]
pub struct ChannelMessageAdapter {
    messages: Arc<dyn MessageCommands>,
}
impl ChannelMessageAdapter {
    /// Construct a usable writer; channel management does not own this dependency.
    pub fn new(messages: Arc<dyn MessageCommands>) -> Self {
        Self { messages }
    }
    fn messages(
        &self,
        access: &EntityAccessReceipt<MessageWrite>,
    ) -> Result<&dyn MessageCommands, ChannelMutationErr> {
        if access.entity().entity_type != EntityType::Channel {
            return Err(ChannelMutationErr::BadRequest(
                "expected a channel capability".into(),
            ));
        }
        Ok(self.messages.as_ref())
    }
}
#[async_trait::async_trait]
impl ChannelMessageCommands for ChannelMessageAdapter {
    #[tracing::instrument(err, skip(self, access, req))]
    async fn post_message(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        req: PostMessageRequest,
    ) -> Result<PostMessageResponse, ChannelMutationErr> {
        let nonce = req.nonce.clone();
        let message = self
            .messages(&access)?
            .post(
                access,
                PostMessage {
                    attribution: if req.triggered_by.is_some() {
                        messages::domain::models::MessageAttribution::ActingUser
                    } else {
                        messages::domain::models::MessageAttribution::Unprompted
                    },
                    content: req.content,
                    thread_id: req.thread_id,
                    anchor: None,
                    mentions: req.mentions,
                    attachments: req.attachments,
                    nonce: req.nonce,
                    notification_policy: req.notification_policy,
                },
            )
            .await
            .map_err(shared_message_error)?;
        Ok(PostMessageResponse {
            id: message.id.to_string(),
            nonce,
        })
    }

    #[tracing::instrument(err, skip(self, access, req))]
    async fn patch_message(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        message_id: Uuid,
        req: PatchMessageRequest,
    ) -> Result<(), ChannelMutationErr> {
        let attachments =
            if req.attachment_ids_to_delete.is_some() || req.attachments_to_add.is_some() {
                AttachmentChange::Delta {
                    remove: req
                        .attachment_ids_to_delete
                        .unwrap_or_default()
                        .into_iter()
                        .map(|id| id.parse::<Uuid>())
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| ChannelMutationErr::BadRequest(e.to_string()))?,
                    add: req.attachments_to_add.unwrap_or_default(),
                }
            } else {
                AttachmentChange::Preserve
            };
        self.messages(&access)?
            .patch(
                access,
                message_id,
                MessagePatch {
                    content: req.content,
                    mentions: req.mentions,
                    attachments,
                    nonce: req.nonce,
                    notification_policy: req.notification_policy,
                },
            )
            .await
            .map_err(shared_message_error)?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, access, query))]
    async fn delete_message(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        message_id: Uuid,
        query: DeleteMessageQuery,
    ) -> Result<(), ChannelMutationErr> {
        self.messages(&access)?
            .delete(access, message_id, query.nonce)
            .await
            .map_err(shared_message_error)?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, access, req))]
    async fn post_reaction(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        req: PostReactionRequest,
    ) -> Result<(), ChannelMutationErr> {
        let message_id = req
            .message_id
            .parse()
            .map_err(|e: uuid::Error| ChannelMutationErr::BadRequest(e.to_string()))?;
        self.messages(&access)?
            .react(
                access,
                message_id,
                req.emoji,
                matches!(req.action, ReactionAction::Add),
                req.nonce,
            )
            .await
            .map_err(shared_message_error)?;
        Ok(())
    }
}

fn shared_message_error(error: MessageError) -> ChannelMutationErr {
    match error {
        MessageError::NotFound => ChannelMutationErr::NotFound("message not found".into()),
        MessageError::Forbidden => ChannelMutationErr::Unauthorized("message access denied".into()),
        MessageError::Invalid(message) => ChannelMutationErr::BadRequest(message.into()),
        other => ChannelMutationErr::Repo(anyhow::anyhow!(other.to_string())),
    }
}

#[cfg(test)]
mod test;
