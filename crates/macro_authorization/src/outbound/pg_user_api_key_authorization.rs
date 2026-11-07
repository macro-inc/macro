//! PostgreSQL user API key authorization facts.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use thiserror::Error;

use crate::domain::{
    models::{AccountManagerCredential, ResolvedApiKeyUser},
    ports::UserApiKeyAuthorizationRepo,
};

/// SHA-256 of a raw user API key's UTF-8 bytes.
///
/// Must stay identical to `user_api_key::hash_key` and `bearer_token::hash_token`.
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
    id: String,
    fusion_user_id: Option<uuid::Uuid>,
    organization_id: Option<i32>,
    account_manager_grant_id: Option<uuid::Uuid>,
    manager_user_id: Option<String>,
}

impl TryFrom<ApiKeyUserRow> for ResolvedApiKeyUser {
    type Error = PgUserApiKeyAuthorizationRepoError;

    fn try_from(row: ApiKeyUserRow) -> Result<Self, Self::Error> {
        let macro_user_id = MacroUserIdStr::try_from(row.id)
            .map_err(|_| PgUserApiKeyAuthorizationRepoError::InvalidUserIdentity)?;
        let fusion_user_id = row
            .fusion_user_id
            .ok_or(PgUserApiKeyAuthorizationRepoError::InvalidUserIdentity)?
            .to_string();
        let account_manager = match (row.account_manager_grant_id, row.manager_user_id) {
            (Some(grant_id), Some(manager_user_id)) => Some(AccountManagerCredential {
                grant_id,
                manager_user_id: MacroUserIdStr::try_from(manager_user_id)
                    .map_err(|_| PgUserApiKeyAuthorizationRepoError::InvalidUserIdentity)?,
            }),
            _ => None,
        };

        Ok(Self {
            macro_user_id,
            fusion_user_id,
            organization_id: row.organization_id,
            account_manager,
        })
    }
}

impl UserApiKeyAuthorizationRepo for PgUserApiKeyAuthorizationRepo {
    type Err = PgUserApiKeyAuthorizationRepoError;

    async fn find_key_owner(&self, api_key: &str) -> Result<Option<ResolvedApiKeyUser>, Self::Err> {
        let key_hash = hash_user_api_key(api_key);
        let row = sqlx::query_as!(
            ApiKeyUserRow,
            r#"
            SELECT
                u.id AS "id!",
                u.macro_user_id AS "fusion_user_id?",
                u."organizationId" AS "organization_id?",
                NULL::uuid AS "account_manager_grant_id?",
                NULL::text AS "manager_user_id?"
            FROM "UserApiKey" k
            JOIN "User" u ON u.id = k.user_id
            WHERE k.hash = $1
            UNION ALL
            SELECT
                u.id,
                u.macro_user_id,
                u."organizationId",
                g.id,
                g.manager_user_id
            FROM account_manager_grants g
            JOIN "User" u ON u.id = g.managed_user_id
            WHERE g.key_hash = $1
              AND g.status = 'active'
            "#,
            &key_hash[..],
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ResolvedApiKeyUser::try_from).transpose()
    }

    async fn mark_account_manager_grant_used(&self, grant_id: uuid::Uuid) -> Result<(), Self::Err> {
        // Throttled, and skips a row another request is updating, so a busy
        // credential never queues its requests on the row lock.
        sqlx::query!(
            r#"
            UPDATE account_manager_grants
            SET last_used_at = now()
            WHERE id = (
                SELECT id FROM account_manager_grants
                WHERE id = $1
                  AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
                FOR UPDATE SKIP LOCKED
            )
            "#,
            grant_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
