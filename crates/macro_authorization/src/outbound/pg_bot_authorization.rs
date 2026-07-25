//! PostgreSQL bot authorization facts.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    models::{
        BotActingUserClaims, BotAuthorizationOwner, BotTokenAuthorization, ResolvedBotActingUser,
    },
    ports::BotAuthorizationRepo,
};

/// PostgreSQL facts required by bot authorization policy.
#[derive(Clone, Debug)]
pub struct PgBotAuthorizationRepo {
    pool: PgPool,
}

impl PgBotAuthorizationRepo {
    /// Create a PostgreSQL bot authorization repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Bot authorizer backed by PostgreSQL.
pub type PgBotAuthorizer =
    crate::domain::bot_authorizer::BotAuthorizerService<PgBotAuthorizationRepo>;

/// PostgreSQL bot authorization repository error.
#[derive(Debug, Error)]
pub enum PgBotAuthorizationRepoError {
    /// A database operation failed.
    #[error("bot authorization database operation failed")]
    Database(#[from] sqlx::Error),
    /// Persisted bot ownership data violated its schema invariant.
    #[error("invalid persisted bot ownership data")]
    InvalidBotOwner,
    /// Persisted user data could not be represented as a Macro user identifier.
    #[error("invalid persisted user email")]
    InvalidUserEmail,
}

#[derive(Debug)]
struct BotTokenAuthorizationRow {
    token_id: Uuid,
    bot_id: Uuid,
    kind: String,
    owner_user_id: Option<String>,
    team_id: Option<Uuid>,
}

impl TryFrom<BotTokenAuthorizationRow> for BotTokenAuthorization {
    type Error = PgBotAuthorizationRepoError;

    fn try_from(row: BotTokenAuthorizationRow) -> Result<Self, Self::Error> {
        let owner = match (row.kind.as_str(), row.owner_user_id, row.team_id) {
            ("owned", Some(user_id), None) => BotAuthorizationOwner::User { user_id },
            ("owned", None, Some(team_id)) => BotAuthorizationOwner::Team { team_id },
            ("system", None, None) => BotAuthorizationOwner::System,
            _ => return Err(PgBotAuthorizationRepoError::InvalidBotOwner),
        };

        Ok(Self {
            bot_id: bot_id::BotId::new_from_uuid(row.bot_id),
            token_id: row.token_id,
            owner,
        })
    }
}

#[derive(Debug)]
struct ActingUserRow {
    fusion_user_id: String,
    email: String,
    organization_id: Option<i32>,
}

impl TryFrom<ActingUserRow> for ResolvedBotActingUser {
    type Error = PgBotAuthorizationRepoError;

    fn try_from(row: ActingUserRow) -> Result<Self, Self::Error> {
        Ok(Self {
            macro_user_id: MacroUserIdStr::try_from_email(&row.email)
                .map_err(|_| PgBotAuthorizationRepoError::InvalidUserEmail)?,
            fusion_user_id: row.fusion_user_id,
            organization_id: row.organization_id,
        })
    }
}

impl BotAuthorizationRepo for PgBotAuthorizationRepo {
    type Err = PgBotAuthorizationRepoError;

    async fn find_valid_bot_token(
        &self,
        token: &str,
    ) -> Result<Option<BotTokenAuthorization>, Self::Err> {
        let row = sqlx::query_as!(
            BotTokenAuthorizationRow,
            r#"
            SELECT
                bt.id AS token_id,
                b.id AS bot_id,
                b.kind,
                b.owner_user_id,
                b.team_id
            FROM bot_tokens bt
            JOIN bots b ON b.id = bt.bot_id
            WHERE bt.token = $1
              AND bt.revoked_at IS NULL
              AND (bt.expires_at IS NULL OR bt.expires_at > now())
              AND b.deleted_at IS NULL
            "#,
            token,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(BotTokenAuthorization::try_from).transpose()
    }

    async fn mark_token_used(&self, token_id: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE bot_tokens
            SET last_used_at = now()
            WHERE id = $1
            "#,
            token_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn find_acting_user(
        &self,
        claims: &BotActingUserClaims,
    ) -> Result<Option<ResolvedBotActingUser>, Self::Err> {
        let row = if let Some(macro_user_id) = claims.user_id.as_deref() {
            let Ok(macro_user_id) = MacroUserIdStr::try_from(macro_user_id) else {
                return Ok(None);
            };

            sqlx::query_as!(
                ActingUserRow,
                r#"
                SELECT
                    id AS fusion_user_id,
                    email,
                    "organizationId" AS "organization_id?"
                FROM "User"
                WHERE email = $1
                "#,
                macro_user_id.email_str(),
            )
            .fetch_optional(&self.pool)
            .await?
        } else if let Some(fusion_user_id) = claims.fusion_user_id.as_deref() {
            sqlx::query_as!(
                ActingUserRow,
                r#"
                SELECT
                    id AS fusion_user_id,
                    email,
                    "organizationId" AS "organization_id?"
                FROM "User"
                WHERE id = $1
                "#,
                fusion_user_id,
            )
            .fetch_optional(&self.pool)
            .await?
        } else {
            None
        };

        row.map(ResolvedBotActingUser::try_from).transpose()
    }

    async fn user_has_team(&self, fusion_user_id: &str, team_id: Uuid) -> Result<bool, Self::Err> {
        let has_team = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1 AND team_id = $2
            ) AS "has_team!"
            "#,
            fusion_user_id,
            team_id,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(has_team)
    }
}
