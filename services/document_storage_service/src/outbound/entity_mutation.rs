//! Adapter for document and email-thread lifecycle operations that still use
//! the legacy database clients.

use std::sync::Arc;

use crate::{
    api::util::count_occurrences,
    service::entity_mutation::{EntityLifecycleService, LifecycleError},
};
use entity_mutation::{EntityMutationActor, EntityRef};
use macro_sha_count_client::Redis;
use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use sqlx::PgPool;
use sqs_client::search::{SearchQueueMessage, document::DocumentId};

/// Wrap a legacy client failure as an internal lifecycle error.
macro_rules! internal {
    ($error:expr) => {
        LifecycleError::Internal(rootcause::report!($error).into())
    };
}

/// Map a direct row lookup failure, treating a missing row as `NotFound`.
fn row_error(error: sqlx::Error) -> LifecycleError {
    match error {
        sqlx::Error::RowNotFound => LifecycleError::NotFound,
        error => internal!(error),
    }
}

/// Production lifecycle adapter backed by the legacy persistence clients.
pub struct DssEntityLifecycleAdapter {
    db: PgPool,
    redis: Arc<Redis>,
    sqs: Arc<sqs_client::SQS>,
}

impl DssEntityLifecycleAdapter {
    /// Construct the adapter from concrete outbound dependencies.
    pub fn new(db: PgPool, redis: Arc<Redis>, sqs: Arc<sqs_client::SQS>) -> Self {
        Self { db, redis, sqs }
    }
}

#[async_trait::async_trait]
impl EntityLifecycleService for DssEntityLifecycleAdapter {
    async fn update_thread_share_policy(
        &self,
        _actor: &EntityMutationActor,
        entity: &EntityRef,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityRef>, LifecycleError> {
        // Threads get their share-permission row lazily; mirror the REST
        // middleware's get-or-create so a first-time share succeeds. The
        // caller has already proven Owner access, so the thread exists.
        let permission =
            macro_middleware::cloud_storage::thread::ensure_thread_exists::insert_thread_share_permissions(
                &self.db,
                &entity.entity_id,
            )
            .await
            .map_err(|error| internal!(error))?;
        let thread_id = uuid::Uuid::parse_str(&entity.entity_id)
            .map_err(|error| LifecycleError::InvalidInput(format!("invalid thread id: {error}")))?;
        let mut transaction = self.db.begin().await.map_err(|error| internal!(error))?;
        macro_db_client::share_permission::edit::edit_thread_permission(
            &mut transaction,
            &thread_id,
            &permission.share_permission_id,
            &policy,
        )
        .await
        .map_err(|error| internal!(error))?;
        transaction
            .commit()
            .await
            .map_err(|error| internal!(error))?;
        Ok(Vec::new())
    }

    async fn restore_document(
        &self,
        _actor: &EntityMutationActor,
        entity: &EntityRef,
    ) -> Result<Vec<EntityRef>, LifecycleError> {
        let document = macro_db_client::document::get_basic_document(&self.db, &entity.entity_id)
            .await
            .map_err(row_error)?;
        macro_db_client::document::revert_delete::revert_delete_document(
            &self.db,
            &entity.entity_id,
            document.project_id.as_deref(),
        )
        .await
        .map_err(|error| internal!(error))?;
        Ok(document
            .project_id
            .into_iter()
            .map(|id| EntityRef::new(EntityType::Project, id))
            .collect())
    }

    async fn delete_document_permanently(
        &self,
        _actor: &EntityMutationActor,
        entity: &EntityRef,
    ) -> Result<Vec<EntityRef>, LifecycleError> {
        let document = macro_db_client::document::get_basic_document(&self.db, &entity.entity_id)
            .await
            .map_err(row_error)?;
        if document.file_type.as_deref() == Some("docx") {
            let bom_parts = macro_db_client::document::get_bom_parts(&self.db, &entity.entity_id)
                .await
                .map_err(|error| internal!(error))?;
            self.redis
                .decrement_counts(&count_occurrences(
                    bom_parts.into_iter().map(|part| part.sha).collect(),
                ))
                .await
                .map_err(|error| internal!(error))?;
        }
        macro_db_client::document::delete_document(&self.db, &entity.entity_id)
            .await
            .map_err(|error| internal!(error))?;
        comms_db_client::entity_mentions::delete_entity_mentions_by_source(
            &self.db,
            vec![entity.entity_id.clone()],
        )
        .await
        .inspect_err(|error| tracing::error!(error = ?error, "unable to delete entity mentions"))
        .ok();
        self.sqs
            .enqueue_document_delete(document.owner.as_ref(), &entity.entity_id)
            .await
            .map_err(|error| internal!(error))?;
        self.sqs
            .send_message_to_search_event_queue(SearchQueueMessage::RemoveDocument(DocumentId {
                document_id: entity.entity_id.clone(),
            }))
            .await
            .map_err(|error| internal!(error))?;
        Ok(document
            .project_id
            .into_iter()
            .map(|id| EntityRef::new(EntityType::Project, id))
            .collect())
    }
}
