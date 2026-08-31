//! PostgreSQL user API key authorization facts.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use thiserror::Error;

use crate::domain::{models::ResolvedApiKeyUser, ports::UserApiKeyAuthorizationRepo};

/// PostgreSQL facts required by user API key authorization policy.
#[derive(Clone, Debug)]
pub struct PgUserApiKeyAuthorizationRepo {
    pool: PgPool,
}

impl PgUserApiKeyAuthorizationRepo {
    /// Create a PostgreSQL user API key authorization repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// User API key authorizer backed by PostgreSQL.
pub type PgUserApiKeyAuthorizer =
    crate::domain::user_api_key_authorizer::UserApiKeyAuthorizerService<
        PgUserApiKeyAuthorizationRepo,
    >;

/// PostgreSQL user API key authorization repository error.
#[derive(Debug, Error)]
pub enum PgUserApiKeyAuthorizationRepoError {
    /// A database operation failed.
    #[error("user api key authorization database operation failed")]
    Database(#[from] sqlx::Error),
    /// Persisted user data could not be represented as a Macro user identifier.
    #[error("invalid persisted user identity")]
    InvalidUserIdentity,
}

#[derive(Debug)]
struct ApiKeyUserRow {
    user_id: String,
    fusion_user_id: String,
    email: String,
    organization_id: Option<i32>,
}

impl TryFrom<ApiKeyUserRow> for ResolvedApiKeyUser {
    type Error = PgUserApiKeyAuthorizationRepoError;

    fn try_from(row: ApiKeyUserRow) -> Result<Self, Self::Error> {
        let macro_user_id = MacroUserIdStr::try_from(row.user_id)
            .or_else(|_| MacroUserIdStr::try_from_email(&row.email))
            .map_err(|_| PgUserApiKeyAuthorizationRepoError::InvalidUserIdentity)?;

        Ok(Self {
            macro_user_id,
            fusion_user_id: row.fusion_user_id,
            organization_id: row.organization_id,
        })
    }
}

impl UserApiKeyAuthorizationRepo for PgUserApiKeyAuthorizationRepo {
    type Err = PgUserApiKeyAuthorizationRepoError;

    async fn find_key_owner(&self, api_key: &str) -> Result<Option<ResolvedApiKeyUser>, Self::Err> {
        let row = sqlx::query_as!(
            ApiKeyUserRow,
            r#"
            SELECT
                k.user_id,
                u.id AS fusion_user_id,
                u.email,
                u."organizationId" AS "organization_id?"
            FROM "UserApiKey" k
            JOIN "User" u ON u.id = k.user_id
            WHERE k.key = $1
            "#,
            api_key,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ResolvedApiKeyUser::try_from).transpose()
    }
}
