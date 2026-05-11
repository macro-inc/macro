//! Query for resolving the team a user belongs to and the role they hold.

#[cfg(test)]
mod test;

use crate::domain::models::{TeamRole, UserTeamInfo};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;

/// Parse a team role string from the database.
fn parse_role(s: &str) -> TeamRole {
    match s {
        "owner" => TeamRole::Owner,
        "admin" => TeamRole::Admin,
        _ => TeamRole::Member,
    }
}

/// Look up the team a user belongs to and the role they hold.
///
/// Users are expected to belong to at most one team, but this query is
/// defensive — if `team_user` returns multiple rows the highest-privileged
/// role wins. Postgres orders the `team_role` enum as
/// `member < admin < owner`, so `ORDER BY team_role DESC` returns the
/// strongest membership first.
#[tracing::instrument(err, skip(pool))]
pub async fn get_user_team(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Option<UserTeamInfo>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT team_id, team_role::text as "role!"
        FROM team_user
        WHERE user_id = $1
        ORDER BY team_role DESC
        LIMIT 1
        "#,
        user_id.as_ref(),
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| UserTeamInfo {
        team_id: r.team_id,
        role: parse_role(&r.role),
    }))
}
