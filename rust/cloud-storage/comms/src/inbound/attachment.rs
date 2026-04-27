//! Attachment inbound adapter for the comms domain.

use std::fmt::Write;
use std::sync::Arc;

use attachment::fmt::XmlTag;
use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentReference, AttachmentService,
    Attachments, ResolutionError,
};
use entity_access::domain::{
    models::{AccessError, MemberParticipantRole},
    ports::EntityAccessService,
};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_comms::channel::{ChannelId, ChannelMessage};
use non_empty::NonEmpty;

use crate::domain::ports::CommsRepo;

const MESSAGE_LIMIT: u32 = 50;

/// Resolves channel IDs into [`Attachments`].
pub struct CommsAttachmentService<C, E> {
    comms_repo: Arc<C>,
    entity_access_service: Arc<E>,
}

impl<C, E> CommsAttachmentService<C, E> {
    /// Create a new comms attachment service.
    pub fn new(comms_repo: Arc<C>, entity_access_service: Arc<E>) -> Self {
        Self {
            comms_repo,
            entity_access_service,
        }
    }
}

impl<C: CommsRepo, E: EntityAccessService> AttachmentService for CommsAttachmentService<C, E> {
    #[tracing::instrument(skip_all)]
    async fn resolve_attachments(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&str]>,
    ) -> Attachments {
        let user_id = &user_id;
        let results = join_all(ids.iter().map(|id| async move {
            self.resolve_one(user_id, id)
                .await
                .map_err(|error| ResolutionError::new(id.to_string(), error))
        }))
        .await;
        Attachments::new(NonEmpty::new(results).expect("ids was non-empty"))
    }
}

impl<C: CommsRepo, E: EntityAccessService> CommsAttachmentService<C, E> {
    #[tracing::instrument(skip(self), err)]
    async fn resolve_one(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: &str,
    ) -> Result<AttachmentContent, AttachmentError> {
        let channel_id =
            ChannelId(uuid::Uuid::parse_str(id).map_err(|e| AttachmentError::Internal(e.into()))?);

        self.entity_access_service
            .generate_entity_access_receipt::<MemberParticipantRole>(
                user_id,
                None,
                id,
                EntityType::Channel,
            )
            .await
            .map_err(|e| match e {
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                    AttachmentError::PermissionDenied { id: id.to_string() }
                }
                other => AttachmentError::Internal(anyhow::anyhow!("{other:#}")),
            })?;

        let (name, messages) = tokio::join!(
            self.comms_repo.get_channel_name(channel_id),
            self.comms_repo
                .get_recent_messages(channel_id, MESSAGE_LIMIT),
        );

        let name = name.map_err(|e| AttachmentError::Internal(anyhow::anyhow!("{e:#}")))?;
        let mut messages =
            messages.map_err(|e| AttachmentError::Internal(anyhow::anyhow!("{e:#}")))?;
        messages.reverse();

        let parts = format_messages(&messages);

        Ok(AttachmentContent {
            reference: AttachmentReference::Channel { id: id.to_string() },
            name,
            content: NonEmpty::new(vec![AttachmentPart::Content(parts)])
                .expect("single element is non-empty"),
        })
    }
}

fn format_messages(messages: &[ChannelMessage]) -> String {
    if messages.is_empty() {
        return "(no messages)".to_string();
    }

    let mut body = String::new();
    for msg in messages {
        let timestamp = msg.created_at.format("%Y-%m-%d %H:%M");
        let tag = XmlTag {
            name: "message",
            attrs: &[
                ("sender", &msg.sender_id),
                ("timestamp", &timestamp.to_string()),
            ],
            body: &msg.content,
        };
        writeln!(&mut body, "{tag}").expect("write to string");
    }
    body
}
