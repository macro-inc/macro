//! Adapter for document and email-thread lifecycle operations that still use
//! the legacy database clients.

use std::sync::Arc;

use crate::{
    api::util::count_occurrences,
    service::{
        document_event_publisher::publish_document_purged_event,
        entity_mutation::{EntityLifecycleService, LifecycleError},
    },
};
use entity_mutation::EntityMutationActor;
use macro_event_broker::MacroEventBroker;
use macro_sha_count_client::Redis;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use sqlx::PgPool;

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
pub struct DssEntityLifecycleAdapter<B: MacroEventBroker> {
    db: PgPool,
    redis: Arc<Redis>,
    sqs: Arc<sqs_client::SQS>,
    event_broker: B,
}

impl<B: MacroEventBroker> DssEntityLifecycleAdapter<B> {
    /// Construct the adapter from concrete outbound dependencies.
    pub fn new(db: PgPool, redis: Arc<Redis>, sqs: Arc<sqs_client::SQS>, event_broker: B) -> Self {
        Self {
            db,
            redis,
            sqs,
            event_broker,
        }
    }
}

impl<B: MacroEventBroker> EntityLifecycleService for DssEntityLifecycleAdapter<B> {
    async fn update_thread_share_policy(
        &self,
        _actor: &EntityMutationActor,
        entity: &Entity<'static>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
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
        entity: &Entity<'static>,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
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
            .map(|id| EntityType::Project.with_entity_string(id))
            .collect())
    }

    async fn delete_document_permanently(
        &self,
        _actor: &EntityMutationActor,
        entity: &Entity<'static>,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
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
            vec![entity.entity_id.to_string()],
        )
        .await
        .inspect_err(|error| tracing::error!(error = ?error, "unable to delete entity mentions"))
        .ok();
        self.sqs
            .enqueue_document_delete(document.owner.as_ref(), &entity.entity_id)
            .await
            .map_err(|error| internal!(error))?;
        publish_document_purged_event(&self.event_broker, &entity.entity_id)
            .map_err(|error| internal!(error))?;
        Ok(document
            .project_id
            .into_iter()
            .map(|id| EntityType::Project.with_entity_string(id))
            .collect())
    }
}
