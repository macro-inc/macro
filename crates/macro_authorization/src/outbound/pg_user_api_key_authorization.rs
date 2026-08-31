//! PostgreSQL user API key authorization facts.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use thiserror::Error;

use crate::domain::{models::ResolvedApiKeyUser, ports::UserApiKeyAuthorizationRepo};

/// SHA-256 of a raw user API key's UTF-8 bytes.
///
/// Must stay identical to `user_api_key::hash_key` and `bot_token::hash_token`.
fn hash_user_api_key(api_key: &str) -> [u8; 32] {
    Sha256::digest(api_key.as_bytes()).into()
}

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
    email: String,
    fusion_user_id: Option<uuid::Uuid>,
    organization_id: Option<i32>,
}

impl TryFrom<ApiKeyUserRow> for ResolvedApiKeyUser {
    type Error = PgUserApiKeyAuthorizationRepoError;

    fn try_from(row: ApiKeyUserRow) -> Result<Self, Self::Error> {
        let macro_user_id = MacroUserIdStr::try_from_email(&row.email)
            .map_err(|_| PgUserApiKeyAuthorizationRepoError::InvalidUserIdentity)?;
        let fusion_user_id = row
            .fusion_user_id
            .ok_or(PgUserApiKeyAuthorizationRepoError::InvalidUserIdentity)?
            .to_string();

        Ok(Self {
            macro_user_id,
            fusion_user_id,
            organization_id: row.organization_id,
        })
    }
}

impl UserApiKeyAuthorizationRepo for PgUserApiKeyAuthorizationRepo {
    type Err = PgUserApiKeyAuthorizationRepoError;

    async fn find_key_owner(&self, api_key: &str) -> Result<Option<ResolvedApiKeyUser>, Self::Err> {
        let key_hash = hash_user_api_key(api_key);
        // Keys store a Macro user id (`macro|email`). `User.id` is the FusionAuth
        // identifier, so join by that id or by the email suffix. `fusion_user_id`
        // in UserContext is the JWT `root_macro_id`, which is `User.macro_user_id`.
        let row = sqlx::query_as!(
            ApiKeyUserRow,
            r#"
            SELECT
                u.email,
                u.macro_user_id AS "fusion_user_id?",
                u."organizationId" AS "organization_id?"
            FROM "UserApiKey" k
            JOIN "User" u
                ON u.id = k.user_id
                OR u.email = split_part(k.user_id, '|', 2)
            WHERE k.hash = $1
            "#,
            &key_hash[..],
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ResolvedApiKeyUser::try_from).transpose()
    }
}
