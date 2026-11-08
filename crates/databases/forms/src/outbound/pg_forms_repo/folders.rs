//! Filing a form in a folder, with the grants the folder passes down.

use entity_access_db_utils::project_grants::{drop_project_grants, inherit_project_grants};
use entity_access_db_utils::team_share;
use entity_kind::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgFormsRepoError;
use crate::domain::models::FormId;

/// File a live form in `project_id`, or at the root, swapping the grants it
/// inherited from its old folder for the new folder's; `false` when it is
/// trashed or gone.
pub(super) async fn move_form(
    pool: &PgPool,
    id: FormId,
    project_id: Option<&str>,
) -> Result<bool, PgFormsRepoError> {
    let mut transaction = pool.begin().await?;
    // The team-share guard comes before any row lock, as its writer requires.
    team_share::acquire_guard(&mut transaction).await?;
    let Some(previous) = sqlx::query_scalar!(
        "SELECT project_id FROM forms WHERE id = $1 AND trashed_at IS NULL FOR UPDATE",
        id.into_uuid(),
    )
    .fetch_optional(&mut *transaction)
    .await?
    else {
        return Ok(false);
    };
    sqlx::query!(
        "UPDATE forms SET project_id = $2, updated_at = now() WHERE id = $1",
        id.into_uuid(),
        project_id,
    )
    .execute(&mut *transaction)
    .await?;
    if let Some(previous) = previous {
        drop_project_grants(
            &mut transaction,
            id.as_uuid(),
            EntityType::Form,
            &Uuid::parse_str(&previous)?,
        )
        .await?;
    }
    if let Some(project_id) = project_id {
        inherit_project_grants(
            &mut transaction,
            id.as_uuid(),
            EntityType::Form,
            &Uuid::parse_str(project_id)?,
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(true)
}

/// Return the forms filed directly in any of `project_ids` to the root,
/// trashed or not, dropping the grants each inherited from its folder and the
/// folders above.
#[tracing::instrument(skip(pool), err)]
pub(super) async fn unfile_from_projects(
    pool: &PgPool,
    project_ids: &[String],
) -> Result<(), PgFormsRepoError> {
    let mut transaction = pool.begin().await?;
    // The team-share guard comes before any row lock, as its writer requires.
    team_share::acquire_guard(&mut transaction).await?;
    let unfiled = sqlx::query!(
        r#"
        UPDATE forms AS current
        SET project_id = NULL, updated_at = now()
        FROM forms AS previous
        WHERE previous.id = current.id AND previous.project_id = ANY($1)
        RETURNING current.id, previous.project_id AS "project_id!"
        "#,
        project_ids,
    )
    .fetch_all(&mut *transaction)
    .await?;
    for row in unfiled {
        drop_project_grants(
            &mut transaction,
            &row.id,
            EntityType::Form,
            &Uuid::parse_str(&row.project_id)?,
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}
