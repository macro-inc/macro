//! Grants an entity inherits from the folders (projects) it is filed in.
//!
//! An entity in a folder holds one `entity_access` row per grant on that
//! folder or any folder above it, marked with `granted_from_project_id`.
//! Callers hold [`crate::team_share::acquire_guard`] in the same transaction.

use entity_kind::EntityType;
use models_entity_access_management::EntityAccessSourceType;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Postgres, QueryBuilder, Transaction};

use crate::walk_up_project_tree;

/// A grant made directly on a folder, which the folder's contents inherit.
#[derive(Clone, Debug)]
pub struct ProjectGrantSource {
    /// The folder the grant was made on.
    pub project_id: macro_uuid::Uuid,
    /// The user, channel or team granted access.
    pub source_id: String,
    /// What kind of grantee `source_id` is.
    pub source_type: EntityAccessSourceType,
    /// The level granted.
    pub access_level: AccessLevel,
}

/// The grants made directly on any of `project_ids`.
#[tracing::instrument(skip(transaction), err)]
pub async fn project_grant_sources(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[macro_uuid::Uuid],
) -> Result<Vec<ProjectGrantSource>, sqlx::Error> {
    sqlx::query!(
        r#"
        SELECT
        entity_id,
        source_id,
        source_type as "source_type:EntityAccessSourceType",
        access_level as "access_level:AccessLevel"
        FROM entity_access
        WHERE entity_id = ANY($1) AND entity_type = 'project' AND granted_from_project_id IS NULL
        "#,
        project_ids,
    )
    .map(|r| ProjectGrantSource {
        project_id: r.entity_id,
        source_id: r.source_id,
        source_type: r.source_type,
        access_level: r.access_level,
    })
    .fetch_all(transaction.as_mut())
    .await
}

/// Give an entity just filed in `project_id` the grants of that folder and
/// every folder above it.
#[tracing::instrument(skip(transaction), err)]
pub async fn inherit_project_grants(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    project_id: &macro_uuid::Uuid,
) -> Result<(), sqlx::Error> {
    let project_ids = walk_up_project_tree(transaction, project_id).await?;
    let sources = project_grant_sources(transaction, &project_ids).await?;
    if sources.is_empty() {
        return Ok(());
    }
    let entity_type: &str = entity_type.into();
    let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
    );
    query.push_values(&sources, |mut row, source| {
        row.push_bind(entity_id)
            .push_bind(entity_type)
            .push_bind(&source.source_id)
            .push_bind(source.source_type)
            .push_bind(source.access_level)
            .push_bind(source.project_id.to_string());
    });
    query.push(" ON CONFLICT DO NOTHING");
    query.build().execute(transaction.as_mut()).await?;
    Ok(())
}

/// Drop the grants an entity inherited from `old_project_id` and every
/// folder above it, as it leaves that folder.
#[tracing::instrument(skip(transaction), err)]
pub async fn drop_project_grants(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    old_project_id: &macro_uuid::Uuid,
) -> Result<(), sqlx::Error> {
    let project_ids = walk_up_project_tree(transaction, old_project_id)
        .await?
        .into_iter()
        .map(|id| id.to_string())
        .collect::<Vec<String>>();
    if project_ids.is_empty() {
        return Ok(());
    }
    let entity_type: &str = entity_type.into();
    sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE entity_id = $1
        AND entity_type = $2
        AND granted_from_project_id = ANY($3)
        "#,
        entity_id,
        entity_type,
        &project_ids,
    )
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}
