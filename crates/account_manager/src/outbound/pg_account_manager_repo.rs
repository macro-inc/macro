//! PostgreSQL repository for `account_manager_grants`.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AccountManagerDecision, AccountManagerGrant, AccountManagerGrantStatus, AccountManagerRole,
};
use crate::domain::ports::{AccountManagerRepo, OpenedRequest};

/// Errors from the Postgres repository.
#[derive(Debug, thiserror::Error)]
pub enum PgAccountManagerRepoError {
    /// A database operation failed.
    #[error("account manager database operation failed")]
    Database(#[from] sqlx::Error),
    /// A stored row can't be represented in the domain.
    #[error("invalid stored account manager grant")]
    InvalidRow,
}

/// Postgres-backed grant storage.
#[derive(Debug, Clone)]
pub struct PgAccountManagerRepo {
    pool: PgPool,
}

impl PgAccountManagerRepo {
    /// Create a repository over the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct GrantRow {
    id: Uuid,
    managed_user_id: String,
    manager_user_id: String,
    requested_by: String,
    status: String,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    claimed_at: Option<DateTime<Utc>>,
    last_used_at: Option<DateTime<Utc>>,
}

impl TryFrom<GrantRow> for AccountManagerGrant {
    type Error = PgAccountManagerRepoError;

    fn try_from(row: GrantRow) -> Result<Self, Self::Error> {
        let invalid = |_| PgAccountManagerRepoError::InvalidRow;

        Ok(Self {
            id: row.id,
            managed_user_id: MacroUserIdStr::try_from(row.managed_user_id)
                .map_err(|_| PgAccountManagerRepoError::InvalidRow)?,
            manager_user_id: MacroUserIdStr::try_from(row.manager_user_id)
                .map_err(|_| PgAccountManagerRepoError::InvalidRow)?,
            requested_by: row
                .requested_by
                .parse::<AccountManagerRole>()
                .map_err(invalid)?,
            status: row
                .status
                .parse::<AccountManagerGrantStatus>()
                .map_err(invalid)?,
            expires_at: row.expires_at,
            created_at: row.created_at,
            claimed_at: row.claimed_at,
            last_used_at: row.last_used_at,
        })
    }
}

fn grant(row: Option<GrantRow>) -> Result<Option<AccountManagerGrant>, PgAccountManagerRepoError> {
    row.map(AccountManagerGrant::try_from).transpose()
}

impl AccountManagerRepo for PgAccountManagerRepo {
    type Err = PgAccountManagerRepoError;

    async fn is_agent(&self, user: &MacroUserIdStr<'_>) -> Result<Option<bool>, Self::Err> {
        let is_agent = sqlx::query_scalar!(
            r#"SELECT "isAgent" FROM "User" WHERE id = $1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(is_agent)
    }

    async fn open_request(
        &self,
        id: Uuid,
        managed: &MacroUserIdStr<'_>,
        manager: &MacroUserIdStr<'_>,
        requested_by: AccountManagerRole,
        expires_at: DateTime<Utc>,
    ) -> Result<OpenedRequest, Self::Err> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!(
            r#"
            UPDATE account_manager_grants
            SET status = 'expired', expires_at = NULL
            WHERE managed_user_id = $1
              AND manager_user_id = $2
              AND status = 'pending'
              AND expires_at <= now()
            "#,
            managed.as_ref(),
            manager.as_ref(),
        )
        .execute(&mut *tx)
        .await?;

        let inserted = sqlx::query_as!(
            GrantRow,
            r#"
            INSERT INTO account_manager_grants
                (id, managed_user_id, manager_user_id, requested_by, status, expires_at)
            VALUES ($1, $2, $3, $4, 'pending', $5)
            ON CONFLICT (managed_user_id, manager_user_id) WHERE status = 'pending' DO NOTHING
            RETURNING id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                created_at, claimed_at, last_used_at
            "#,
            id,
            managed.as_ref(),
            manager.as_ref(),
            requested_by.to_string(),
            expires_at,
        )
        .fetch_optional(&mut *tx)
        .await?;

        let (row, created) = match inserted {
            Some(row) => (row, true),
            None => {
                let existing = sqlx::query_as!(
                    GrantRow,
                    r#"
                    SELECT id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                        created_at, claimed_at, last_used_at
                    FROM account_manager_grants
                    WHERE managed_user_id = $1
                      AND manager_user_id = $2
                      AND status = 'pending'
                    "#,
                    managed.as_ref(),
                    manager.as_ref(),
                )
                .fetch_one(&mut *tx)
                .await?;
                (existing, false)
            }
        };

        tx.commit().await?;

        Ok(OpenedRequest {
            grant: row.try_into()?,
            created,
        })
    }

    async fn get(&self, id: Uuid) -> Result<Option<AccountManagerGrant>, Self::Err> {
        let row = sqlx::query_as!(
            GrantRow,
            r#"
            SELECT id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                created_at, claimed_at, last_used_at
            FROM account_manager_grants
            WHERE id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;

        grant(row)
    }

    async fn list_for_managed(
        &self,
        managed: &MacroUserIdStr<'_>,
    ) -> Result<Vec<AccountManagerGrant>, Self::Err> {
        let rows = sqlx::query_as!(
            GrantRow,
            r#"
            SELECT id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                created_at, claimed_at, last_used_at
            FROM account_manager_grants
            WHERE managed_user_id = $1
              AND status IN ('approved', 'active')
            ORDER BY id DESC
            "#,
            managed.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(AccountManagerGrant::try_from)
            .collect()
    }

    async fn respond(
        &self,
        id: Uuid,
        decision: AccountManagerDecision,
        claim_expires_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<Option<AccountManagerGrant>, Self::Err> {
        let (status, expires_at) = match decision {
            AccountManagerDecision::Approve => {
                (AccountManagerGrantStatus::Approved, Some(claim_expires_at))
            }
            AccountManagerDecision::Decline => (AccountManagerGrantStatus::Declined, None),
        };
        let row = sqlx::query_as!(
            GrantRow,
            r#"
            UPDATE account_manager_grants
            SET status = $2, expires_at = $3
            WHERE id = $1
              AND status = 'pending'
              AND expires_at > $4
            RETURNING id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                created_at, claimed_at, last_used_at
            "#,
            id,
            status.to_string(),
            expires_at,
            now,
        )
        .fetch_optional(&self.pool)
        .await?;

        grant(row)
    }

    async fn claim(
        &self,
        id: Uuid,
        key_hash: &[u8; 32],
        now: DateTime<Utc>,
    ) -> Result<Option<AccountManagerGrant>, Self::Err> {
        let mut tx = self.pool.begin().await?;

        // Taking the row first means a concurrent claim waits, then finds it
        // no longer approved.
        let claimable = sqlx::query!(
            r#"
            SELECT managed_user_id, manager_user_id
            FROM account_manager_grants
            WHERE id = $1
              AND status = 'approved'
              AND expires_at > $2
            FOR UPDATE
            "#,
            id,
            now,
        )
        .fetch_optional(&mut *tx)
        .await?;

        let Some(pair) = claimable else {
            return Ok(None);
        };

        sqlx::query!(
            r#"
            UPDATE account_manager_grants
            SET status = 'revoked', key_hash = NULL
            WHERE managed_user_id = $1
              AND manager_user_id = $2
              AND status = 'active'
            "#,
            pair.managed_user_id,
            pair.manager_user_id,
        )
        .execute(&mut *tx)
        .await?;

        let row = sqlx::query_as!(
            GrantRow,
            r#"
            UPDATE account_manager_grants
            SET status = 'active', key_hash = $2, expires_at = NULL, claimed_at = $3
            WHERE id = $1
            RETURNING id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                created_at, claimed_at, last_used_at
            "#,
            id,
            &key_hash[..],
            now,
        )
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        grant(Some(row))
    }

    async fn revoke(&self, id: Uuid) -> Result<Option<AccountManagerGrant>, Self::Err> {
        let row = sqlx::query_as!(
            GrantRow,
            r#"
            UPDATE account_manager_grants
            SET status = 'revoked', key_hash = NULL, expires_at = NULL
            WHERE id = $1
              AND status IN ('pending', 'approved', 'active')
            RETURNING id, managed_user_id, manager_user_id, requested_by, status, expires_at,
                created_at, claimed_at, last_used_at
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;

        grant(row)
    }
}
