//! Attachment inbound adapter for the email domain.

use std::sync::Arc;

use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentService, Attachments,
    ResolutionError,
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;
use uuid::Uuid;

use crate::domain::{
    models::{ContactInfo, ParsedMessage, ParsedThread},
    ports::EmailService,
};

const MAX_MESSAGES: i64 = 50;

/// Resolves email thread IDs into [`Attachments`].
pub struct EmailAttachmentService<Svc, ESvc> {
    service: Arc<Svc>,
    entity_access_service: Arc<ESvc>,
}

impl<Svc, ESvc> EmailAttachmentService<Svc, ESvc> {
    /// Create a new email attachment service.
    pub fn new(service: Arc<Svc>, entity_access_service: Arc<ESvc>) -> Self {
        Self {
            service,
            entity_access_service,
        }
    }
}

impl<Svc: EmailService, ESvc: EntityAccessService> AttachmentService
    for EmailAttachmentService<Svc, ESvc>
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

impl<Svc: EmailService, ESvc: EntityAccessService> EmailAttachmentService<Svc, ESvc> {
    #[tracing::instrument(skip(self), err)]
    async fn resolve_one(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<AttachmentContent<'static>, AttachmentError> {
        let id = &*entity.entity_id;
        let thread_id = Uuid::parse_str(id)
            .map_err(|e| AttachmentError::Internal(anyhow::anyhow!("invalid thread ID: {e}")))?;

        let receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user_id,
                None,
                id,
                EntityType::EmailThread,
            )
            .await
            .map_err(|e| AttachmentError::PermissionDenied(Box::new(e)))?;

        let thread = self
            .service
            .get_thread_parsed(receipt, 0, MAX_MESSAGES)
            .await
            .map_err(|e| AttachmentError::Internal(e.into()))?
            .ok_or_else(|| {
                AttachmentError::Internal(anyhow::anyhow!("thread {thread_id} not found"))
            })?;

        format_thread(id, &thread)
    }
}

fn format_thread(
    id: &str,
    thread: &ParsedThread,
) -> Result<AttachmentContent<'static>, AttachmentError> {
    let subject = thread
        .messages
        .first()
        .and_then(|m| m.subject.as_deref())
        .map(String::from);

    let parts: Vec<AttachmentPart<'static>> =
        thread.messages.iter().flat_map(format_message).collect();

    let content = NonEmpty::new(parts).map_err(|_| AttachmentError::NoContent)?;

    Ok(AttachmentContent {
        reference: EntityType::EmailThread.with_entity_string(id.to_string()),
        name: subject,
        content,
    })
}

fn format_message(msg: &ParsedMessage) -> Vec<AttachmentPart<'static>> {
    let mut parts = Vec::new();

    if let Some(subject) = &msg.subject {
        parts.push(AttachmentPart::Metadata {
            key: "subject".to_string(),
            value: subject.clone(),
        });
    }

    if let Some(from) = &msg.from {
        parts.push(AttachmentPart::Metadata {
            key: "from".to_string(),
            value: format_contact(from),
        });
    }

    if !msg.to.is_empty() {
        parts.push(AttachmentPart::Metadata {
            key: "to".to_string(),
            value: format_contacts(&msg.to),
        });
    }

    if !msg.cc.is_empty() {
        parts.push(AttachmentPart::Metadata {
            key: "cc".to_string(),
            value: format_contacts(&msg.cc),
        });
    }

    if let Some(date) = msg.internal_date_ts {
        parts.push(AttachmentPart::Metadata {
            key: "date".to_string(),
            value: date.to_rfc3339(),
        });
    }

    if let Some(body) = &msg.body_parsed {
        parts.push(AttachmentPart::Content(body.clone()));
    }

    parts
}

fn format_contact(contact: &ContactInfo) -> String {
    match &contact.name {
        Some(name) => format!("{name} <{}>", contact.email),
        None => contact.email.clone(),
    }
}

fn format_contacts(contacts: &[ContactInfo]) -> String {
    contacts
        .iter()
        .map(format_contact)
        .collect::<Vec<_>>()
        .join(", ")
}
