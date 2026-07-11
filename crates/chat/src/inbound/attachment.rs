//! Attachment inbound adapter for the chat domain.

use std::sync::Arc;

use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentService, Attachments,
    ResolutionError, fmt::XmlTag,
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::ChatMessageWithAttachments;
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;

use crate::domain::ports::ChatRepo;

/// Resolves chat IDs into [`Attachments`].
pub struct ChatAttachmentService<R, ESvc> {
    repo: Arc<R>,
    entity_access_service: Arc<ESvc>,
}

impl<R, ESvc> ChatAttachmentService<R, ESvc> {
    /// Create a new chat attachment service.
    pub fn new(repo: Arc<R>, entity_access_service: Arc<ESvc>) -> Self {
        Self {
            repo,
            entity_access_service,
        }
    }
}

impl<R: ChatRepo, ESvc: EntityAccessService> AttachmentService for ChatAttachmentService<R, ESvc> {
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

impl<R: ChatRepo, ESvc: EntityAccessService> ChatAttachmentService<R, ESvc> {
    #[tracing::instrument(skip(self), err)]
    async fn resolve_one<'a>(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &'a Entity<'a>,
    ) -> Result<AttachmentContent<'a>, AttachmentError> {
        self.entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user_id,
                None,
                &entity.entity_id,
                EntityType::Chat,
            )
            .await
            .map_err(|e| AttachmentError::Internal(e.into()))?;

        let chat = self
            .repo
            .get_chat(&entity.entity_id)
            .await
            .map_err(|e| AttachmentError::Internal(e.into()))?;

        let parts: Vec<AttachmentPart<'static>> =
            chat.messages.iter().filter_map(format_message).collect();

        let content = NonEmpty::new(parts).map_err(|_| AttachmentError::NoContent)?;

        Ok(AttachmentContent {
            reference: entity.clone(),
            name: Some(chat.name),
            content,
        })
    }
}

fn format_message(msg: &ChatMessageWithAttachments) -> Option<AttachmentPart<'static>> {
    let text = msg.content_text()?;
    if text.is_empty() {
        return None;
    }
    let role = match msg.role {
        agent::types::Role::User => "user",
        agent::types::Role::Assistant => "assistant",
        agent::types::Role::System => "system",
    };
    let formatted = XmlTag {
        name: "message",
        attrs: attachment::fmt::attrs(&[("role", role)]),
        body: &text,
    }
    .to_string();
    Some(AttachmentPart::Content(formatted))
}
