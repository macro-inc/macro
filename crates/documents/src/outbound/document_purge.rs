//! Adapters preserving the established permanent document cleanup behavior.

use super::super::domain::{
    models::DocumentError,
    purge::{
        DocumentAudience, DocumentPurgeQueue, DocumentPurgeRepository, DocxPartReferences,
        PurgeTarget, PurgedRows,
    },
};
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use std::sync::Arc;

/// Existing document deletion queries behind the owning document boundary.
pub struct LegacyDocumentPurgeRepository {
    pool: sqlx::PgPool,
}

impl LegacyDocumentPurgeRepository {
    /// Compose from the application's database pool.
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }
}

impl DocumentPurgeRepository for LegacyDocumentPurgeRepository {
    #[tracing::instrument(skip(self), err)]
    async fn find(&self, document_id: &str) -> Result<Option<PurgeTarget>, DocumentError> {
        match macro_db_client::document::get_deleted_document_info(&self.pool, document_id).await {
            Ok(document) => Ok(Some(PurgeTarget {
                owner: document.owner,
                file_type: document.file_type,
            })),
            Err(sqlx::Error::RowNotFound) => Ok(None),
            Err(error) => Err(DocumentError::Internal(error.into())),
        }
    }

    #[tracing::instrument(skip(self, target), fields(file_type = ?target.file_type), err)]
    async fn purge_rows(
        &self,
        document_id: &str,
        target: &PurgeTarget,
    ) -> Result<PurgedRows, DocumentError> {
        let docx_part_shas = if target.file_type.as_deref() == Some("docx") {
            macro_db_client::document::get_bom_parts(&self.pool, document_id)
                .await
                .map_err(DocumentError::Internal)?
                .into_iter()
                .map(|part| part.sha)
                .collect()
        } else {
            Vec::new()
        };
        macro_db_client::document::delete_document(&self.pool, document_id)
            .await
            .map_err(DocumentError::Internal)?;
        comms_db_client::entity_mentions::delete_entity_mentions_by_source(
            &self.pool,
            vec![document_id.to_owned()],
        )
        .await
        .inspect_err(|error| {
            tracing::error!(?error, %document_id, "unable to delete outgoing document mentions");
        })
        .ok();
        Ok(PurgedRows { docx_part_shas })
    }
}

/// Adapter for the application's existing document deletion queue.
pub struct SqsDocumentPurgeQueue {
    sqs: Arc<sqs_client::SQS>,
}

impl SqsDocumentPurgeQueue {
    /// Compose from the application's configured queue client.
    pub fn new(sqs: Arc<sqs_client::SQS>) -> Self {
        Self { sqs }
    }
}

impl DocumentPurgeQueue for SqsDocumentPurgeQueue {
    async fn enqueue(&self, document_id: String, owner: Owner) -> Result<(), DocumentError> {
        self.sqs
            .enqueue_document_delete(&owner.principal_id(), &document_id)
            .await
            .map_err(DocumentError::Internal)
    }
}

/// Docx part references in the shared SHA counter.
pub struct RedisDocxPartReferences {
    sha_counts: Arc<macro_sha_count_client::Redis>,
}

impl RedisDocxPartReferences {
    /// Compose from the application's SHA counter client.
    pub fn new(sha_counts: Arc<macro_sha_count_client::Redis>) -> Self {
        Self { sha_counts }
    }
}

impl DocxPartReferences for RedisDocxPartReferences {
    async fn release(&self, shas: Vec<String>) -> Result<(), DocumentError> {
        self.sha_counts
            .release_shas(shas)
            .await
            .map_err(DocumentError::Internal)
    }
}

/// A document's audience as the entity access service resolves it.
pub struct EntityAccessDocumentAudience<S> {
    access: Arc<S>,
}

impl<S> EntityAccessDocumentAudience<S> {
    /// Compose from the application's entity access service.
    pub fn new(access: Arc<S>) -> Self {
        Self { access }
    }
}

impl<S: EntityAccessService> DocumentAudience for EntityAccessDocumentAudience<S> {
    #[tracing::instrument(skip(self), err)]
    async fn users(
        &self,
        document_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, DocumentError> {
        self.access
            .get_users_by_entity(document_id, EntityType::Document)
            .await
            .map_err(|error| DocumentError::Internal(error.into()))
    }
}

#[cfg(test)]
mod test;
