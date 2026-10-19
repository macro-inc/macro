//! PostgreSQL facts for forwarded-attachment authorization and source selection.
use email::domain::forwarded_attachments::{ForwardedAttachmentRepo, ForwardedAttachmentSource};
use email::domain::models::{AttachmentForwarded, MessageAttachment};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Adapter for existing email attachment queries.
#[derive(Clone)]
pub struct PgForwardedAttachmentRepo(pub sqlx::PgPool);

/// Preserve database errors across the domain port.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct ForwardedAttachmentRepoError(#[from] anyhow::Error);

impl ForwardedAttachmentRepo for PgForwardedAttachmentRepo {
    type Err = ForwardedAttachmentRepoError;

    #[tracing::instrument(skip(self, actor), err)]
    async fn accessible_inboxes(&self, actor: &MacroUserIdStr<'_>) -> Result<Vec<Uuid>, Self::Err> {
        Ok(
            email_db_client::links::get::fetch_inboxes_for_macro_id(&self.0, actor.as_ref())
                .await?
                .into_iter()
                .map(|link| link.id)
                .collect(),
        )
    }

    #[tracing::instrument(skip(self), err)]
    async fn draft_exists(&self, link_id: Uuid, draft_id: Uuid) -> Result<bool, Self::Err> {
        Ok(
            email_db_client::messages::get::draft_exists_with_id(&self.0, link_id, draft_id)
                .await?,
        )
    }

    #[tracing::instrument(skip(self), err)]
    async fn source_attachment(
        &self,
        attachment_id: Uuid,
    ) -> Result<Option<(Uuid, MessageAttachment)>, Self::Err> {
        let Some((_, source_link_id)) =
            email_db_client::attachments::provider::get_thread_id_for_attachment(
                &self.0,
                attachment_id,
            )
            .await?
        else {
            return Ok(None);
        };
        Ok(
            email_db_client::attachments::provider::fetch_attachment_by_id(
                &self.0,
                attachment_id,
                source_link_id,
            )
            .await?
            .map(|(attachment, _)| {
                (
                    source_link_id,
                    MessageAttachment {
                        reference_url: attachment.reference_url,
                        db_id: attachment.db_id,
                        provider_id: attachment.provider_id,
                        filename: attachment.filename,
                        mime_type: attachment.mime_type,
                        size_bytes: attachment.size_bytes,
                        sfs_id: attachment.sfs_id,
                        content_id: attachment.content_id,
                    },
                )
            }),
        )
    }

    #[tracing::instrument(skip(self), err)]
    async fn insert(
        &self,
        link_id: Uuid,
        draft_id: Uuid,
        attachment_id: Uuid,
    ) -> Result<(), Self::Err> {
        Ok(
            email_db_client::attachments::forwarded::insert_forwarded_attachment(
                &self.0,
                link_id,
                draft_id,
                attachment_id,
            )
            .await?,
        )
    }

    #[tracing::instrument(skip(self), err)]
    async fn registered_sources(
        &self,
        link_id: Uuid,
        draft_id: Uuid,
    ) -> Result<Vec<ForwardedAttachmentSource>, Self::Err> {
        Ok(
            email_db_client::attachments::forwarded::fetch_forwarded_attachments_by_draft_id(
                &self.0, link_id, draft_id,
            )
            .await?
            .into_iter()
            .map(|source| ForwardedAttachmentSource {
                source_link_id: source.source_link_id,
                attachment: AttachmentForwarded {
                    attachment_id: source.attachment_id,
                    draft_id: source.draft_id,
                    provider_attachment_id: source.provider_attachment_id,
                    message_provider_id: source.message_provider_id,
                    filename: source.filename,
                    mime_type: source.mime_type,
                    size_bytes: source.size_bytes,
                },
            })
            .collect(),
        )
    }
}
