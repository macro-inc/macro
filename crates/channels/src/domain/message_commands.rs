//! Channel request translation into the shared message command boundary.
use super::{
    models::{
        DeleteMessageQuery, NewChannelAttachment, PatchMessageRequest, PostMessageRequest,
        PostMessageResponse, PostReactionRequest, PostTypingRequest, ReactionAction, TypingAction,
    },
    ports::{ChannelMessageCommands, ChannelMutationErr},
};
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use messages::domain::{
    api::MessageCommands,
    models::{MessageAttribution, NewAttachment, PostMessage},
    ports::{AttachmentChange, MessageError, MessagePatch},
    service::MessageWrite,
};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Adapter for the existing channel message endpoints and internal channel writers.
#[derive(Clone)]
pub struct ChannelMessageAdapter {
    messages: Arc<dyn MessageCommands>,
}

impl ChannelMessageAdapter {
    /// Construct a channel writer over the shared message commands.
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
                    id: None,
                    attribution: if req.triggered_by.is_some() {
                        MessageAttribution::ActingUser
                    } else {
                        MessageAttribution::Unprompted
                    },
                    content: req.content,
                    thread_id: req.thread_id,
                    anchor: None,
                    mentions: req.mentions,
                    attachments: shared_attachments(req.attachments),
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
                    add: shared_attachments(req.attachments_to_add.unwrap_or_default()),
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

    #[tracing::instrument(err, skip(self, access, req))]
    async fn post_typing(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        req: PostTypingRequest,
    ) -> Result<(), ChannelMutationErr> {
        let thread_id = req
            .thread_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|e| ChannelMutationErr::BadRequest(e.to_string()))?;
        self.messages(&access)?
            .typing(
                access,
                thread_id,
                matches!(req.action, TypingAction::Start),
                req.nonce,
            )
            .await
            .map_err(shared_message_error)?;
        Ok(())
    }
}

fn shared_attachments(attachments: Vec<NewChannelAttachment>) -> Vec<NewAttachment> {
    attachments
        .into_iter()
        .map(|attachment| NewAttachment {
            entity_type: attachment.entity_type,
            entity_id: attachment.entity_id,
            width: attachment.width,
            height: attachment.height,
        })
        .collect()
}

fn shared_message_error(error: MessageError) -> ChannelMutationErr {
    match error {
        MessageError::NotFound => ChannelMutationErr::NotFound("message not found".into()),
        MessageError::Forbidden => ChannelMutationErr::Unauthorized("message access denied".into()),
        MessageError::Invalid(message) => ChannelMutationErr::BadRequest(message.into()),
        MessageError::Conflict => {
            ChannelMutationErr::BadRequest("message id already exists".into())
        }
        MessageError::Repository(report) => {
            ChannelMutationErr::Repo(anyhow::anyhow!(report.to_string()))
        }
    }
}
