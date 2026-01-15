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

/// Computes an advisory lock key from a user ID string.
/// Combines a namespace constant with a hash of the user ID.
fn compute_lock_key<'a>(user_id: &MacroUserId<Lowercase<'a>>) -> i64 {
    let mut hasher = DefaultHasher::new();
    user_id.as_ref().hash(&mut hasher);
    let hash = hasher.finish();
    // Use the lower 32 bits of the hash combined with the namespace
    // to create a unique lock key
    REFRESH_TOKEN_LOCK_NAMESPACE + (hash as i64 & 0x7FFFFFFF)
}

/// Attempts to acquire a transaction-level advisory lock for the given user ID.
/// Returns `true` if the lock was acquired, `false` if another transaction holds the lock.
///
/// The lock is automatically released when the transaction commits or rolls back.
/// This is the preferred method over session-level locks as it prevents lock leaks.
#[tracing::instrument(skip(transaction))]
pub async fn try_acquire_user_refresh_xact_lock<'a>(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &MacroUserId<Lowercase<'a>>,
) -> anyhow::Result<bool> {
    let lock_key = compute_lock_key(user_id);

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
