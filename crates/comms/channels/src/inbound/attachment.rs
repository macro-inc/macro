//! Attachment inbound adapter for the channels domain.

use std::fmt::Write;
use std::sync::Arc;

use attachment::fmt::{XmlTag, attrs};
use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentService, Attachments,
    ResolutionError,
};
use entity_access::domain::{models::MemberParticipantRole, ports::EntityAccessService};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;
use uuid::Uuid;

use crate::domain::{models::RecentChannelMessage, ports::ChannelAttachmentRepo};

const MESSAGE_LIMIT: u32 = 50;

/// Resolves channel IDs into [`Attachments`].
pub struct ChannelAttachmentService<C, E> {
    channel_repo: Arc<C>,
    entity_access_service: Arc<E>,
}

impl<C, E> ChannelAttachmentService<C, E> {
    /// Create a new channel attachment service.
    pub fn new(channel_repo: Arc<C>, entity_access_service: Arc<E>) -> Self {
        Self {
            channel_repo,
            entity_access_service,
        }
    }
}

impl<C: ChannelAttachmentRepo, E: EntityAccessService> AttachmentService
    for ChannelAttachmentService<C, E>
{
    #[tracing::instrument(skip_all)]
    async fn resolve_attachments<'a>(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> Attachments<'a> {
        let user_id = &user_id;
        let results = join_all(ids.iter().map(|entity| async move {
            self.resolve_one(user_id, entity).await.map_err(|error| {
                ResolutionError::new(
                    entity
                        .entity_type
                        .with_entity_string(entity.entity_id.to_string()),
                    error,
                )
            })
        }))
        .await;
        Attachments::new(NonEmpty::new(results).expect("ids was non-empty"))
    }
}

impl<C: ChannelAttachmentRepo, E: EntityAccessService> ChannelAttachmentService<C, E> {
    #[tracing::instrument(skip(self), err)]
    async fn resolve_one(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<AttachmentContent<'static>, AttachmentError> {
        let id = &*entity.entity_id;
        let channel_id = Uuid::parse_str(id).map_err(|e| AttachmentError::Internal(e.into()))?;

        self.entity_access_service
            .generate_entity_access_receipt::<MemberParticipantRole>(
                user_id,
                None,
                id,
                EntityType::Channel,
            )
            .await
            .map_err(|e| AttachmentError::PermissionDenied(Box::new(e)))?;

        let (name, messages) = tokio::join!(
            self.channel_repo
                .get_channel_name_for_attachment(channel_id),
            self.channel_repo
                .get_recent_messages_for_attachment(channel_id, MESSAGE_LIMIT),
        );

        let name = name.map_err(|e| AttachmentError::Internal(e.into()))?;
        let mut messages = messages.map_err(|e| AttachmentError::Internal(e.into()))?;
        messages.reverse();

        let parts = format_messages(&messages);

        Ok(AttachmentContent {
            reference: EntityType::Channel.with_entity_string(id.to_string()),
            name,
            content: NonEmpty::new(vec![
                AttachmentPart::Metadata {
                    key: "message-limit".into(),
                    value: MESSAGE_LIMIT.to_string(),
                },
                AttachmentPart::Content(parts),
            ])
            .expect("single element is non-empty"),
        })
    }
}

fn format_messages(messages: &[RecentChannelMessage]) -> String {
    if messages.is_empty() {
        return "(no messages)".to_string();
    }

    let mut body = String::new();
    for msg in messages {
        let timestamp = msg.created_at.format("%Y-%m-%d %H:%M").to_string();
        let tag = XmlTag {
            name: "message",
            attrs: attrs(&[("sender", &msg.sender_id), ("timestamp", &timestamp)]),
            body: &msg.content,
        };
        writeln!(&mut body, "{tag}").expect("write to string");
    }
    body
}
