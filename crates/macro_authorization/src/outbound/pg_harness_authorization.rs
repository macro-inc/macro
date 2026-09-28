//! PostgreSQL harness authorization facts.

#[cfg(test)]
mod test;

use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    models::{HarnessAuthorizationOwner, HarnessTokenAuthorization, ResolvedBotActingUser},
    ports::HarnessAuthorizationRepo,
};

/// PostgreSQL facts required by harness authorization policy.
#[derive(Clone, Debug)]
pub struct PgHarnessAuthorizationRepo {
    pool: PgPool,
}

impl PgHarnessAuthorizationRepo {
    /// Create a PostgreSQL harness authorization repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Harness authorizer backed by PostgreSQL.
pub type PgHarnessAuthorizer =
    crate::domain::harness_authorizer::HarnessAuthorizerService<PgHarnessAuthorizationRepo>;

/// PostgreSQL harness authorization repository error.
#[derive(Debug, Error)]
pub enum PgHarnessAuthorizationRepoError {
    /// A database operation failed.
    #[error("harness authorization database operation failed")]
    Database(#[from] sqlx::Error),
    /// Persisted harness ownership data violated its schema invariant.
    #[error("invalid persisted harness ownership data")]
    InvalidHarnessOwner,
    /// Persisted user data could not be represented as a Macro user identifier.
    #[error("invalid persisted user email")]
    InvalidUserEmail,
}

#[derive(Debug)]
struct HarnessTokenAuthorizationRow {
    token_id: Uuid,
    harness_id: Uuid,
    owner_user_id: Option<String>,
    team_id: Option<Uuid>,
    created_by: String,
}

impl TryFrom<HarnessTokenAuthorizationRow> for HarnessTokenAuthorization {
    type Error = PgHarnessAuthorizationRepoError;

    fn try_from(row: HarnessTokenAuthorizationRow) -> Result<Self, Self::Error> {
        let owner = match (row.owner_user_id, row.team_id) {
            (Some(user_id), None) => HarnessAuthorizationOwner::User { user_id },
            (None, Some(team_id)) => HarnessAuthorizationOwner::Team { team_id },
            _ => return Err(PgHarnessAuthorizationRepoError::InvalidHarnessOwner),
        };

        Ok(Self {
            harness_id: HarnessId::new_from_uuid(row.harness_id),
            token_id: row.token_id,
            owner,
            created_by: row.created_by,
        })
    }
}

#[derive(Debug)]
struct UserRow {
    fusion_user_id: String,
    email: String,
    organization_id: Option<i32>,
}

impl TryFrom<UserRow> for ResolvedBotActingUser {
    type Error = PgHarnessAuthorizationRepoError;

    fn try_from(row: UserRow) -> Result<Self, Self::Error> {
        Ok(Self {
            macro_user_id: MacroUserIdStr::try_from_email(&row.email)
                .map_err(|_| PgHarnessAuthorizationRepoError::InvalidUserEmail)?,
            fusion_user_id: row.fusion_user_id,
            organization_id: row.organization_id,
        })
    }
}

impl HarnessAuthorizationRepo for PgHarnessAuthorizationRepo {
    type Err = PgHarnessAuthorizationRepoError;

    async fn find_valid_harness_token(
        &self,
        token: &str,
    ) -> Result<Option<HarnessTokenAuthorization>, Self::Err> {
        let token_hash = harness_token::hash_token(token);
        let row = sqlx::query_as!(
            HarnessTokenAuthorizationRow,
            r#"
            SELECT
                ht.id AS token_id,
                h.id AS harness_id,
                h.owner_user_id,
                h.team_id,
                h.created_by
            FROM harness_tokens ht
            JOIN harnesses h ON h.id = ht.harness_id
            WHERE ht.token_hash = $1
              AND ht.revoked_at IS NULL
              AND h.deleted_at IS NULL
            "#,
            &token_hash[..],
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(HarnessTokenAuthorization::try_from).transpose()
    }

    async fn mark_harness_token_used(&self, token_id: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE harness_tokens
            SET last_used_at = now()
            WHERE id = $1
            "#,
            token_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn find_user(
        &self,
        macro_user_id: &str,
    ) -> Result<Option<ResolvedBotActingUser>, Self::Err> {
        let Ok(macro_user_id) = MacroUserIdStr::try_from(macro_user_id) else {
            return Ok(None);
        };

        let row = sqlx::query_as!(
            UserRow,
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
        .await?;

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
