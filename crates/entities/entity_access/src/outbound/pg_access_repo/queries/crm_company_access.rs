//! Query for CRM company access level.

#[cfg(test)]
mod test;

use crate::domain::models::{AccessLevel, CrmEntityAccess, TeamRole};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// Resolve the access level a user has for a CRM company, together with the
/// company's owning `team_id`.
///
/// Joins `crm_companies` against the user's `team_user` row on the owning
/// team, so the returned `team_id` is the team that owns the company *and*
/// that the user belongs to — the caller can scope downstream queries by it
/// without trusting the user's default team. Returns `None` when the user is
/// not on that team, or when the company is hidden and the user is a plain
/// member.
#[tracing::instrument(err, skip(pool))]
pub async fn get_crm_company_access(
    pool: &PgPool,
    company_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<CrmEntityAccess>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            c.hidden AS "hidden!",
            c.team_id AS "team_id!",
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

    Ok(row.and_then(|r| {
        team_role_to_access_level(r.role, r.hidden).map(|access_level| CrmEntityAccess {
            access_level,
            team_id: r.team_id,
            team_role: r.role,
        })
    }))
}

/// Resolve team-scoped access to a visible CRM company owned by the team.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_crm_company_access(
    pool: &PgPool,
    company_id: &Uuid,
    team_id: &Uuid,
) -> Result<Option<CrmEntityAccess>, sqlx::Error> {
    sqlx::query_as!(
        CrmEntityAccess,
        r#"
        SELECT
            'view'::"AccessLevel" AS "access_level!: AccessLevel",
            team_id AS "team_id!",
            'member'::team_role AS "team_role!: TeamRole"
        FROM crm_companies
        WHERE id = $1
          AND team_id = $2
          AND hidden = false
        "#,
        company_id,
        team_id,
    )
    .fetch_optional(pool)
    .await
}

/// Map a team role + hidden flag to an [`AccessLevel`].
///
/// Every team role can edit visible CRM rows (members included, so they can
/// change company properties like Stage / Owner / Revenue). Hidden CRM rows
/// are invisible to plain members; admins and owners keep their normal
/// access. Governance actions (hiding rows, email sync) are gated on the
/// team role by the CRM domain service, not on the access level.
pub(super) fn team_role_to_access_level(role: TeamRole, hidden: bool) -> Option<AccessLevel> {
    match (role, hidden) {
        (TeamRole::Member, true) => None,
        (TeamRole::Member, false) => Some(AccessLevel::Edit),
        (TeamRole::Admin, _) => Some(AccessLevel::Edit),
        (TeamRole::Owner, _) => Some(AccessLevel::Owner),
    }
}
