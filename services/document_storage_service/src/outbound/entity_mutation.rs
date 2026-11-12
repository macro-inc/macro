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
        actor: &EntityMutationActor,
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
            &actor.user_id,
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
        let owner = document.owner.principal_id();
        self.sqs
            .enqueue_document_delete(&owner, &entity.entity_id)
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

#[cfg(test)]
mod test {
    use super::*;
    use macro_event_broker::NoopMacroEventBroker;
    use macro_user_id::user_id::MacroUserIdStr;
    use models_permissions::share_permission::{LinkShare, access_level::AccessLevel};

    async fn migrate_for_test(pool: &PgPool) {
        let migrations = macro_db_migrator::MACRO_DB_MIGRATIONS
            .iter()
            .map(|migration| {
                let mut migration = migration.clone();
                if migration.version == 20261110150956
                    && migration.description == "rox mailbox handles"
                {
                    migration.version = 20261110150959;
                }
                migration
            })
            .collect::<Vec<_>>();
        sqlx::migrate::Migrator {
            migrations: std::borrow::Cow::Owned(migrations),
            ..sqlx::migrate::Migrator::DEFAULT
        }
        .run(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = false)]
    async fn update_thread_share_policy_commits_the_mutation_actor_audit(
        pool: PgPool,
    ) -> anyhow::Result<()> {
        migrate_for_test(&pool).await;
        let thread_id = uuid::Uuid::now_v7();
        let permission_id = thread_id.to_string();
        sqlx::query("INSERT INTO \"SharePermission\" (id) VALUES ($1)")
            .bind(&permission_id)
            .execute(&pool)
            .await?;
        sqlx::query(
            "INSERT INTO \"EmailThreadPermission\" (\"threadId\", \"sharePermissionId\", \"userId\") VALUES ($1, $2, $3)",
        )
        .bind(thread_id.to_string())
        .bind(&permission_id)
        .bind("macro|entity-mutation@example.com")
        .execute(&pool)
        .await?;

        let redis = Arc::new(Redis::new(redis::Client::open("redis://127.0.0.1:6379/")?));
        let sqs_config = aws_sdk_sqs::Config::builder()
            .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
            .build();
        let sqs = Arc::new(sqs_client::SQS::new(aws_sdk_sqs::Client::from_conf(
            sqs_config,
        )));
        let adapter =
            DssEntityLifecycleAdapter::new(pool.clone(), redis, sqs, NoopMacroEventBroker);
        let actor = EntityMutationActor {
            user_id: MacroUserIdStr::try_from("macro|entity-mutation@example.com")?,
            organization_id: None,
        };
        let entity = EntityType::EmailThread.with_entity_string(thread_id.to_string());
        let affected = adapter
            .update_thread_share_policy(
                &actor,
                &entity,
                UpdateSharePermissionRequestV2 {
                    link_share: Some(Some(LinkShare::Public)),
                    link_share_access_level: Some(Some(AccessLevel::Edit)),
                    team_share_access_level: None,
                    channel_share_permissions: None,
                },
            )
            .await?;
        assert!(affected.is_empty());

        let audit_actor: String = sqlx::query_scalar(
            "SELECT actor_id FROM enterprise_audit WHERE resource_id = $1 AND action = 'share_link_create'",
        )
        .bind(thread_id.to_string())
        .fetch_one(&pool)
        .await?;
        assert_eq!(audit_actor, actor.user_id.as_ref());
        Ok(())
    }
}
