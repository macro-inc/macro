//! Query for CRM company access level.

use crate::domain::models::{AccessLevel, TeamRole};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// Resolve the access level a user has for a CRM company.
///
/// Joins `crm_companies` against the user's `team_user` row on the owning
/// team. Returns `None` when the user is not on that team, or when the
/// company is hidden and the user is a plain member.
#[tracing::instrument(err, skip(pool))]
pub async fn get_crm_company_access(
    pool: &PgPool,
    company_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            c.hidden AS "hidden!",
            tu.team_role AS "role!: TeamRole"
        FROM crm_companies c
        JOIN team_user tu
            ON tu.team_id = c.team_id
           AND tu.user_id = $1
        WHERE c.id = $2
        "#,
        user_id.as_ref(),
        company_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.and_then(|r| team_role_to_access_level(r.role, r.hidden)))
}

/// Map a team role + hidden flag to an [`AccessLevel`].
///
/// Hidden CRM rows are invisible to plain members; admins and owners keep
/// their normal access.
pub(super) fn team_role_to_access_level(role: TeamRole, hidden: bool) -> Option<AccessLevel> {
    match (role, hidden) {
        (TeamRole::Member, true) => None,
        (TeamRole::Member, false) => Some(AccessLevel::View),
        (TeamRole::Admin, _) => Some(AccessLevel::Edit),
        (TeamRole::Owner, _) => Some(AccessLevel::Owner),
    }
}
