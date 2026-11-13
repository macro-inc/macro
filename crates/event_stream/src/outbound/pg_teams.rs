//! [`TeamDirectory`] over MacroDB's `team_user`.

use crate::domain::ports::{TeamDirectory, TeamRole};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;
use sqlx::PgPool;
use uuid::Uuid;

/// Team membership read from MacroDB. Both lookups are index-backed
/// (`team_user_team_id_idx`, `team_user_user_id_unique`).
#[derive(Clone)]
pub struct PgTeamDirectory {
    pool: PgPool,
}

impl PgTeamDirectory {
    /// Read membership through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn role(value: &str) -> TeamRole {
    match value {
        "owner" => TeamRole::Owner,
        "admin" => TeamRole::Admin,
        _ => TeamRole::Member,
    }
}

impl TeamDirectory for PgTeamDirectory {
    #[tracing::instrument(name = "events.stream.team_members", skip(self), err)]
    async fn members(
        &self,
        team_id: Uuid,
    ) -> Result<Vec<(MacroUserIdStr<'static>, TeamRole)>, Report> {
        let rows = sqlx::query!(
            r#"SELECT user_id, team_role::text AS "team_role!" FROM team_user WHERE team_id = $1"#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to read team members")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let user = MacroUserIdStr::parse_from_str(&row.user_id)
                    .ok()?
                    .into_owned();
                Some((user, role(&row.team_role)))
            })
            .collect())
    }

    #[tracing::instrument(name = "events.stream.user_teams", skip_all, err)]
    async fn teams_of(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<(Uuid, TeamRole)>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT team_id, team_role::text AS "team_role!"
            FROM team_user
            WHERE user_id = $1
            ORDER BY team_role DESC, team_id
            "#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to read a user's teams")?;
        Ok(rows
            .into_iter()
            .map(|row| (row.team_id, role(&row.team_role)))
            .collect())
    }
}
