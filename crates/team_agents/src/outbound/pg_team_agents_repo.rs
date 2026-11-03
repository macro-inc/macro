//! Postgres adapter for team agent accounts.

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{NewAgentAccount, TeamAgent};
use crate::domain::ports::TeamAgentRepository;

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

impl TeamAgentRepository for PgTeamAgentsRepo {
    type Err = PgTeamAgentsError;

    #[tracing::instrument(skip_all, fields(user_id = %account.user_id), err)]
    async fn create_account(&self, account: &NewAgentAccount) -> Result<(), Self::Err> {
        let fusion_user_id = Uuid::now_v7();
        // Agents never pay or sign in; the placeholder keeps the column's
        // uniqueness, as promoted shared mailboxes do.
        let stripe_customer_id = format!("cus_agent_{fusion_user_id}");
        let mut transaction = self.pool.begin().await?;

        sqlx::query!(
            r#"
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ($1, $2, $3, $4)
            "#,
            fusion_user_id,
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
            fusion_user_id,
            account.email,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO macro_user_info (macro_user_id, first_name, profile_picture)
            VALUES ($1, $2, $3)
            "#,
            fusion_user_id,
            account.name,
            account.avatar_url,
        )
        .execute(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO "User" (id, email, name, "firstName", macro_user_id)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            account.user_id.as_ref(),
            account.email,
            account.name,
            account.name,
            fusion_user_id,
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
            INSERT INTO team_agents
                (user_id, team_id, created_by, job_description, personality, harness_id, mailbox_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            account.user_id.as_ref(),
            account.team_id,
            account.created_by.as_ref(),
            account.job_description,
            account.personality,
            account.harness_id,
            account.mailbox_id,
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
    async fn set_brain(
        &self,
        user_id: &MacroUserIdStr<'_>,
        bot_id: Uuid,
        session_id: Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE team_agents
            SET brain_bot_id = $2, brain_session_id = $3
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
            bot_id,
            session_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<TeamAgent>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT
                a.user_id,
                a.team_id,
                a.created_by,
                a.job_description,
                a.personality,
                a.harness_id,
                a.brain_bot_id,
                a.brain_session_id,
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

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(TeamAgent {
            user_id: self::user_id(row.user_id)?,
            team_id: row.team_id,
            name: row.name,
            job_description: row.job_description,
            personality: row.personality,
            email: row.email,
            created_by: row.created_by.map(self::user_id).transpose()?,
            harness_id: row.harness_id,
            brain_bot_id: row.brain_bot_id,
            brain_session_id: row.brain_session_id,
            created_at: row.created_at,
        }))
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
}
