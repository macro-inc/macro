//! Query for CRM list entry access level.

use crate::domain::models::{AccessLevel, CrmEntityAccess, TeamRole};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

use super::crm_company_access::team_role_to_access_level;

/// Resolve the access level a user has for a CRM list entry, together with
/// the owning `team_id`.
///
/// An entry inherits from its list, and the list from its team, so this joins
/// `crm_list_entries` through `crm_lists` to the user's `team_user` row. The
/// parent record's hidden flag (company, or contact and its company) carries
/// over, so a hidden parent hides its entries from plain members.
#[tracing::instrument(err, skip(pool))]
pub async fn get_crm_list_entry_access(
    pool: &PgPool,
    entry_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<CrmEntityAccess>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            COALESCE(c.hidden, ct.hidden OR cc.hidden, false) AS "hidden!",
            l.team_id AS "team_id!",
            tu.team_role AS "role!: TeamRole"
        FROM crm_list_entries e
        JOIN crm_lists l
            ON l.id = e.list_id
        JOIN team_user tu
            ON tu.team_id = l.team_id
           AND tu.user_id = $1
        LEFT JOIN crm_companies c
            ON l.parent_type = 'company' AND c.id = e.parent_id
        LEFT JOIN crm_contacts ct
            ON l.parent_type = 'contact' AND ct.id = e.parent_id
        LEFT JOIN crm_companies cc
            ON cc.id = ct.company_id
        WHERE e.id = $2
        "#,
        user_id.as_ref(),
        entry_id,
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

/// Resolve team-scoped access to a CRM list entry whose parent is visible.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_crm_list_entry_access(
    pool: &PgPool,
    entry_id: &Uuid,
    team_id: &Uuid,
) -> Result<Option<CrmEntityAccess>, sqlx::Error> {
    sqlx::query_as!(
        CrmEntityAccess,
        r#"
        SELECT
            'view'::"AccessLevel" AS "access_level!: AccessLevel",
            l.team_id AS "team_id!",
            'member'::team_role AS "team_role!: TeamRole"
        FROM crm_list_entries e
        JOIN crm_lists l
            ON l.id = e.list_id
        LEFT JOIN crm_companies c
            ON l.parent_type = 'company' AND c.id = e.parent_id
        LEFT JOIN crm_contacts ct
            ON l.parent_type = 'contact' AND ct.id = e.parent_id
        LEFT JOIN crm_companies cc
            ON cc.id = ct.company_id
        WHERE e.id = $1
          AND l.team_id = $2
          AND COALESCE(c.hidden, ct.hidden OR cc.hidden, false) = false
        "#,
        entry_id,
        team_id,
    )
    .fetch_optional(pool)
    .await
}
