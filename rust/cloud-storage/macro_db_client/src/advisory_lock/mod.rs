use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
};

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Postgres, Transaction};

#[cfg(test)]
mod test;

/// Namespace constant for refresh token locks to avoid collisions with other advisory locks
const REFRESH_TOKEN_LOCK_NAMESPACE: i64 = 1_000_000_000;
/// Namespace constant for subscription-mutation locks
const SUBSCRIPTION_LOCK_NAMESPACE: i64 = 2_000_000_000;

/// Computes an advisory lock key from a namespace and user ID.
fn compute_lock_key(namespace: i64, user_id: &MacroUserId<Lowercase<'_>>) -> i64 {
    let mut hasher = DefaultHasher::new();
    user_id.as_ref().hash(&mut hasher);
    let hash = hasher.finish();
    // Use the lower 31 bits of the hash combined with the namespace
    // to create a unique lock key
    namespace + (hash as i64 & 0x7FFFFFFF)
}

/// Attempts to acquire a transaction-level advisory lock for the given user ID.
/// Returns `true` if the lock was acquired, `false` if another transaction holds the lock.
///
/// The lock is automatically released when the transaction commits or rolls back.
/// This is the preferred method over session-level locks as it prevents lock leaks.
#[tracing::instrument(skip(transaction))]
pub async fn try_acquire_user_refresh_xact_lock(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> anyhow::Result<bool> {
    let lock_key = compute_lock_key(REFRESH_TOKEN_LOCK_NAMESPACE, user_id);

    let result = sqlx::query_scalar!(
        r#"
            SELECT pg_try_advisory_xact_lock($1)
        "#,
        lock_key
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(result.unwrap_or(false))
}

/// Attempts to acquire a transaction-level advisory lock guarding subscription mutations
/// for the given user. Returns `true` if the lock was acquired, `false` if another
/// transaction already holds it.
///
/// Callers should hold the enclosing transaction open for the full duration of the critical
/// section; the lock is released on commit or rollback.
#[tracing::instrument(skip(transaction))]
pub async fn try_acquire_user_subscription_xact_lock(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<bool, sqlx::Error> {
    let lock_key = compute_lock_key(SUBSCRIPTION_LOCK_NAMESPACE, user_id);

    let result = sqlx::query_scalar!(
        r#"
            SELECT pg_try_advisory_xact_lock($1)
        "#,
        lock_key
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(result.unwrap_or(false))
}
