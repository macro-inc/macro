//! Query for CRM contact access level.

use crate::domain::models::{AccessLevel, TeamRole};
use crate::outbound::pg_access_repo::queries::crm_company_access::team_role_to_access_level;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// Resolve the access level a user has for a CRM contact.
///
/// Joins `crm_contacts` through its parent `crm_companies` row to the user's
/// `team_user` membership on the owning team. Returns `None` when the user
/// is not on that team, or when the contact (or its parent company) is
/// hidden and the user is a plain member — hiding a company cascades to
/// its contacts, so either flag suppresses access.
#[tracing::instrument(err, skip(pool))]
pub async fn get_crm_contact_access(
    pool: &PgPool,
    contact_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            (ct.hidden OR c.hidden) AS "hidden!",
            tu.team_role AS "role!: TeamRole"
        FROM crm_contacts ct
        JOIN crm_companies c
            ON c.id = ct.company_id
        JOIN team_user tu
            ON tu.team_id = c.team_id
           AND tu.user_id = $1
        WHERE ct.id = $2
        "#,
        user_id.as_ref(),
        contact_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.and_then(|r| team_role_to_access_level(r.role, r.hidden)))
}
