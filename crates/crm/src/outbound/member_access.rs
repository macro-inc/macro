//! Uncached membership policy facts for CRM services.

use crate::domain::model::CrmError;
use sqlx::PgPool;
use uuid::Uuid;

#[tracing::instrument(name = "crm.member_access", skip_all, fields(team_id = %team_id), err)]
pub(super) async fn member_has_crm_access(
    pool: &PgPool,
    team_id: Uuid,
    user_id: &str,
) -> Result<bool, CrmError> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (
            SELECT 1 FROM team_user
            WHERE team_id = $1 AND user_id = $2
              AND (crm_access OR team_role <> 'member')
        ) AS "allowed!""#,
        team_id,
        user_id,
    )
    .fetch_one(pool)
    .await
    .map_err(|error| CrmError::StorageLayerError(error.into()))
}
