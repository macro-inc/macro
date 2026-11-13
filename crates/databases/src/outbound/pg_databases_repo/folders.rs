//! Filing a database in a folder, with the grants the folder passes down.

use entity_access_db_utils::project_grants::{drop_project_grants, inherit_project_grants};
use entity_access_db_utils::project_modified::bump_projects_modified;
use entity_access_db_utils::team_share;
use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgDatabasesRepoError;
use crate::domain::models::DatabaseId;

/// File a live database in `project_id`, or at the root, swapping the grants
/// it inherited from its old folder for the new folder's and marking both
/// folders edited; `false` when it is trashed or gone.
pub(super) async fn move_database(
    pool: &PgPool,
    id: DatabaseId,
    project_id: Option<&str>,
) -> Result<bool, PgDatabasesRepoError> {
    let mut transaction = pool.begin().await?;
    // The team-share guard comes before any row lock, as its writer requires.
    team_share::acquire_guard(&mut transaction).await?;
    let Some(previous) = sqlx::query_scalar!(
        "SELECT project_id FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL FOR UPDATE",
        id.into_uuid(),
    )
    .fetch_optional(&mut *transaction)
    .await?
    else {
        return Ok(false);
    };
    sqlx::query!(
        "UPDATE database_entities SET project_id = $2, updated_at = now() WHERE database_id = $1",
        id.into_uuid(),
        project_id,
    )
    .execute(&mut *transaction)
    .await?;
    if let Some(previous) = &previous {
        drop_project_grants(
            &mut transaction,
            id.as_uuid(),
            EntityType::Database,
            &Uuid::parse_str(previous)?,
        )
        .await?;
    }
    if let Some(project_id) = project_id {
        inherit_project_grants(
            &mut transaction,
            id.as_uuid(),
            EntityType::Database,
            &Uuid::parse_str(project_id)?,
        )
        .await?;
    }
    let left_and_joined: Vec<&str> = previous.as_deref().into_iter().chain(project_id).collect();
    bump_projects_modified(&mut transaction, &left_and_joined).await?;
    transaction.commit().await?;
    Ok(true)
}

/// Return the databases filed directly in any of `project_ids` to the root,
/// dropping the grants each inherited from its folder and the folders above.
#[tracing::instrument(skip(pool), err)]
pub(super) async fn unfile_from_projects(
    pool: &PgPool,
    project_ids: &[String],
) -> Result<(), PgDatabasesRepoError> {
    let mut transaction = pool.begin().await?;
    // The team-share guard comes before any row lock, as its writer requires.
    team_share::acquire_guard(&mut transaction).await?;
    let unfiled = sqlx::query!(
        r#"
        UPDATE database_entities AS current
        SET project_id = NULL, updated_at = now()
        FROM database_entities AS previous
        WHERE previous.database_id = current.database_id
          AND previous.project_id = ANY($1)
        RETURNING current.database_id, previous.project_id AS "project_id!"
        "#,
        project_ids,
    )
    .fetch_all(&mut *transaction)
    .await?;
    for row in unfiled {
        drop_project_grants(
            &mut transaction,
            &row.database_id,
            EntityType::Database,
            &Uuid::parse_str(&row.project_id)?,
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}
