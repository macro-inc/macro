//! Query for CRM contact access level.

#[cfg(test)]
mod test;

use crate::pg_access_repo::queries::crm_company_access::team_role_to_access_level;
use entity_access::domain::models::{AccessLevel, CrmEntityAccess, TeamRole};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// Resolve the access level a user has for a CRM contact, together with the
/// owning `team_id`.
///
/// Joins `crm_contacts` to the user's `team_user` membership on the
/// contact's team, so the returned `team_id` is the team that owns the
/// contact *and* that the user belongs to. Returns `None` when the user is
/// not on that team, or when the contact (or its parent company, if it has
/// one) is hidden and the user is a plain member — hiding a company
/// cascades to its contacts, so either flag suppresses access.
#[tracing::instrument(err, skip(pool))]
pub async fn get_crm_contact_access(
    pool: &PgPool,
    contact_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<CrmEntityAccess>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            (ct.hidden OR c.hidden IS TRUE) AS "hidden!",
            ct.team_id AS "team_id!",
            tu.team_role AS "role!: TeamRole"
        FROM crm_contacts ct
        LEFT JOIN crm_companies c
            ON c.id = ct.company_id
        JOIN team_user tu
            ON tu.team_id = ct.team_id
           AND tu.user_id = $1
        WHERE ct.id = $2
        "#,
        user_id.as_ref(),
        contact_id,
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

/// Resolve team-scoped access to a visible CRM contact owned by the team.
///
/// A hidden contact or hidden parent company is not visible in team scope.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_crm_contact_access(
    pool: &PgPool,
    contact_id: &Uuid,
    team_id: &Uuid,
) -> Result<Option<CrmEntityAccess>, sqlx::Error> {
    sqlx::query_as!(
        CrmEntityAccess,
        r#"
        SELECT
            'view'::"AccessLevel" AS "access_level!: AccessLevel",
            ct.team_id AS "team_id!",
            'member'::team_role AS "team_role!: TeamRole"
        FROM crm_contacts ct
        LEFT JOIN crm_companies c
          ON c.id = ct.company_id
        WHERE ct.id = $1
          AND ct.team_id = $2
          AND ct.hidden = false
          AND c.hidden IS NOT TRUE
        "#,
        contact_id,
        team_id,
    )
    .fetch_optional(pool)
    .await
}
