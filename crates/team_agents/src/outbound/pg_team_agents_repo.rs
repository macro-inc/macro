//! Postgres adapter for team agent accounts.

use std::str::FromStr;

use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{NewAgentAccount, PersonaSeed, TeamAgent, TeamAgentStatus};
use crate::domain::ports::TeamAgentRepository;

#[cfg(test)]
mod test;

/// Role every self-serve account starts with, as at signup.
const SELF_SERVE_ROLE: &str = "self_serve";

/// Errors from the Postgres team agent repository.
#[derive(Debug, thiserror::Error)]
pub enum PgTeamAgentsError {
    /// A query failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A stored user id is malformed.
    #[error("stored user id {0} is malformed")]
    MalformedUserId(String),
    /// A stored status is not one this build knows.
    #[error("stored status {0} is unknown")]
    UnknownStatus(String),
}

/// Team agent storage in MacroDB.
#[derive(Clone)]
pub struct PgTeamAgentsRepo {
    pool: PgPool,
}

impl PgTeamAgentsRepo {
    /// Builds the repository on a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn user_id(raw: String) -> Result<MacroUserIdStr<'static>, PgTeamAgentsError> {
    MacroUserIdStr::parse_from_str(&raw)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| PgTeamAgentsError::MalformedUserId(raw))
}

/// One `team_agents` row joined with its account's name and email.
struct AgentRow {
    user_id: String,
    team_id: Uuid,
    created_by: Option<String>,
    computer_id: Option<Uuid>,
    status: String,
    status_reason: Option<String>,
    created_at: DateTime<Utc>,
    email: String,
    name: String,
}

impl TryFrom<AgentRow> for TeamAgent {
    type Error = PgTeamAgentsError;

    fn try_from(row: AgentRow) -> Result<Self, Self::Error> {
        let status = TeamAgentStatus::from_str(&row.status)
            .map_err(|_| PgTeamAgentsError::UnknownStatus(row.status.clone()))?;

        Ok(TeamAgent {
            user_id: user_id(row.user_id)?,
            team_id: row.team_id,
            name: row.name,
            email: row.email,
            created_by: row.created_by.map(user_id).transpose()?,
            computer_id: row.computer_id,
            status,
            status_reason: row.status_reason,
            setup: None,
            last_turn_at: None,
            retryable: false,
            payment: None,
            created_at: row.created_at,
        })
    }
}

impl TeamAgentRepository for PgTeamAgentsRepo {
    type Err = PgTeamAgentsError;

    #[tracing::instrument(skip_all, fields(user_id = %account.user_id), err)]
    async fn create_account(&self, account: &NewAgentAccount) -> Result<(), Self::Err> {
        let macro_user_id = Uuid::now_v7();
        // Agents never pay or sign in; the placeholder keeps the column's
        // uniqueness, as promoted shared mailboxes do.
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
            INSERT INTO team_agents (user_id, team_id, created_by, mailbox_id, persona_seed)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            account.user_id.as_ref(),
            account.team_id,
            account.created_by.as_ref(),
            account.mailbox_id,
            sqlx::types::Json(&account.persona_seed) as _,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_account(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        // Deleting macro_user cascades to "User" and everything keyed on it,
        // including the team membership and the team_agents row.
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

    #[tracing::instrument(skip(self), err)]
    async fn get(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<TeamAgent>, Self::Err> {
        let row = sqlx::query_as!(
            AgentRow,
            r#"
            SELECT
                a.user_id,
                a.team_id,
                a.created_by,
                a.computer_id,
                a.status,
                a.status_reason,
                a.created_at,
                u.email,
                COALESCE(mui.first_name, u.name, u.email) AS "name!"
            FROM team_agents a
            JOIN "User" u ON u.id = a.user_id
            LEFT JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
            WHERE a.user_id = $1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(TeamAgent::try_from).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<TeamAgent>, Self::Err> {
        let rows = sqlx::query_as!(
            AgentRow,
            r#"
            SELECT
                a.user_id,
                a.team_id,
                a.created_by,
                a.computer_id,
                a.status,
                a.status_reason,
                a.created_at,
                u.email,
                COALESCE(mui.first_name, u.name, u.email) AS "name!"
            FROM team_agents a
            JOIN "User" u ON u.id = a.user_id
            LEFT JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
            WHERE a.team_id = $1
            ORDER BY a.created_at, a.user_id
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TeamAgent::try_from).collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn persona_seed(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<PersonaSeed>, Self::Err> {
        let seed = sqlx::query_scalar!(
            r#"SELECT persona_seed AS "persona_seed: sqlx::types::Json<PersonaSeed>"
               FROM team_agents WHERE user_id = $1"#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        Ok(seed.map(|seed| seed.0))
    }

    #[tracing::instrument(skip(self), err)]
    async fn mailbox_id(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<String>, Self::Err> {
        let mailbox_id = sqlx::query_scalar!(
            r#"SELECT mailbox_id FROM team_agents WHERE user_id = $1"#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten();

        Ok(mailbox_id)
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_computer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        computer_id: Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE team_agents SET computer_id = $2 WHERE user_id = $1"#,
            user_id.as_ref(),
            computer_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_status(
        &self,
        user_id: &MacroUserIdStr<'_>,
        status: TeamAgentStatus,
        reason: Option<&str>,
    ) -> Result<(), Self::Err> {
        let status: &'static str = status.into();

        sqlx::query!(
            r#"UPDATE team_agents SET status = $2, status_reason = $3 WHERE user_id = $1"#,
            user_id.as_ref(),
            status,
            reason,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
