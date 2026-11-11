//! Postgres adapter for agent teammate accounts.

use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{NewAgentAccount, PersonaSeed, TeamAgentRecord};
use crate::domain::ports::TeamAgentRepository;

#[cfg(test)]
mod test;

/// Role every self-serve account starts with, as at signup.
const SELF_SERVE_ROLE: &str = "self_serve";

/// Errors from the Postgres agent repository.
#[derive(Debug, thiserror::Error)]
pub enum PgTeamAgentsError {
    /// A query failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A stored user id is malformed; the value is not repeated.
    #[error("a stored user id is malformed")]
    MalformedUserId,
}

/// Agent teammate storage in MacroDB.
#[derive(Clone)]
pub struct PgTeamAgentsRepo {
    pool: PgPool,
}

impl PgTeamAgentsRepo {
    /// Build the repository on a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn user_id(raw: String) -> Result<MacroUserIdStr<'static>, PgTeamAgentsError> {
    MacroUserIdStr::parse_from_str(&raw)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| PgTeamAgentsError::MalformedUserId)
}

struct AgentRow {
    user_id: String,
    team_id: Uuid,
    created_by: Option<String>,
    persona_seed: sqlx::types::Json<PersonaSeed>,
    created_at: DateTime<Utc>,
}

impl TryFrom<AgentRow> for TeamAgentRecord {
    type Error = PgTeamAgentsError;

    fn try_from(row: AgentRow) -> Result<Self, Self::Error> {
        Ok(TeamAgentRecord {
            user_id: user_id(row.user_id)?,
            team_id: row.team_id,
            created_by: row.created_by.map(user_id).transpose()?,
            persona_seed: row.persona_seed.0,
            created_at: row.created_at,
        })
    }
}

impl TeamAgentRepository for PgTeamAgentsRepo {
    type Err = PgTeamAgentsError;

    #[tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(account.user_id.as_ref())), err)]
    async fn create_account(&self, account: &NewAgentAccount) -> Result<(), Self::Err> {
        let macro_user_id = Uuid::now_v7();
        // Agents never pay or sign in; the placeholder keeps the column unique.
        let stripe_customer_id = format!("cus_agent_{macro_user_id}");
        let mut transaction = self.pool.begin().await?;

        sqlx::query!(
            r#"
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ($1, $2, $3, $4)
            "#,
            macro_user_id,
            account.user_id.as_ref(),
            account.email,
            stripe_customer_id,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified)
            VALUES ($1, $2, true)
            "#,
            macro_user_id,
            account.email,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO macro_user_info (macro_user_id, first_name, profile_picture)
            VALUES ($1, $2, $3)
            "#,
            macro_user_id,
            account.name,
            account.avatar_url,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO "User" (id, email, name, "firstName", macro_user_id, "isAgent")
            VALUES ($1, $2, $3, $4, $5, TRUE)
            "#,
            account.user_id.as_ref(),
            account.email,
            account.name,
            account.name,
            macro_user_id,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO "RolesOnUsers" ("userId", "roleId")
            VALUES ($1, $2)
            "#,
            account.user_id.as_ref(),
            SELF_SERVE_ROLE,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO team_agents (user_id, team_id, created_by, persona_seed)
            VALUES ($1, $2, $3, $4)
            "#,
            account.user_id.as_ref(),
            account.team_id,
            account.created_by.as_ref(),
            sqlx::types::Json(&account.persona_seed) as _,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete_account(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        // Deleting macro_user cascades to "User" and everything keyed on it,
        // including the team membership, the team_agents row and agent_repos.
        sqlx::query!(
            r#"
            DELETE FROM macro_user
            WHERE id = (SELECT macro_user_id FROM "User" WHERE id = $1)
            "#,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamAgentRecord>, Self::Err> {
        let row = sqlx::query_as!(
            AgentRow,
            r#"
            SELECT user_id, team_id, created_by,
                   persona_seed AS "persona_seed: sqlx::types::Json<PersonaSeed>",
                   created_at
            FROM team_agents
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(TeamAgentRecord::try_from).transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<TeamAgentRecord>, Self::Err> {
        let rows = sqlx::query_as!(
            AgentRow,
            r#"
            SELECT user_id, team_id, created_by,
                   persona_seed AS "persona_seed: sqlx::types::Json<PersonaSeed>",
                   created_at
            FROM team_agents
            WHERE team_id = $1
            ORDER BY created_at, user_id
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TeamAgentRecord::try_from).collect()
    }
}
