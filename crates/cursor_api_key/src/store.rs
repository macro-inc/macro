//! Reading and writing the `cursor_api_keys` row.
//!
//! Only ciphertext passes through here — this module cannot decrypt anything
//! and does not hold a KMS client. That is deliberate: a caller that wants a
//! usable key has to go through [`crate::cipher`], which means every read of a
//! plaintext key is an IAM-gated, CloudTrail-recorded KMS call rather than a
//! plain `SELECT`.

#[cfg(test)]
mod test;

use crate::cipher::EncryptedCursorApiKey;
use chrono::{DateTime, Utc};

/// A stored key, as the row holds it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredCursorApiKey {
    /// The Macro user the key belongs to.
    pub user_id: String,
    /// The ciphertext and what is needed to decrypt it.
    pub encrypted: EncryptedCursorApiKey,
    /// When the key was first registered.
    pub created_at: DateTime<Utc>,
    /// When it was last replaced.
    pub updated_at: DateTime<Utc>,
}

/// Register or replace a user's key.
///
/// Replacing rather than erroring on a second write is the behaviour the
/// settings surface wants: a user pasting a new key after rotating it at Cursor
/// is updating, not conflicting. `created_at` survives the replacement so the
/// row still records when the user first connected.
///
/// # Errors
/// If the row cannot be written — including because `user_id` is not a real
/// user, which the foreign key rejects.
pub async fn upsert_cursor_api_key(
    executor: impl sqlx::PgExecutor<'_>,
    user_id: &str,
    encrypted: &EncryptedCursorApiKey,
) -> anyhow::Result<StoredCursorApiKey> {
    let row = sqlx::query!(
        r#"
        INSERT INTO cursor_api_keys (
            user_id,
            key_ciphertext,
            encryption_version,
            kms_key_id
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET
            key_ciphertext       = EXCLUDED.key_ciphertext,
            encryption_version   = EXCLUDED.encryption_version,
            kms_key_id           = EXCLUDED.kms_key_id,
            updated_at           = NOW()
        RETURNING
            user_id,
            key_ciphertext,
            encryption_version,
            kms_key_id,
            created_at,
            updated_at
        "#,
        user_id,
        &encrypted.key_ciphertext,
        encrypted.encryption_version,
        encrypted.kms_key_id,
    )
    .fetch_one(executor)
    .await?;

    Ok(StoredCursorApiKey {
        user_id: row.user_id,
        encrypted: EncryptedCursorApiKey {
            key_ciphertext: row.key_ciphertext,
            encryption_version: row.encryption_version,
            kms_key_id: row.kms_key_id,
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// The user's key, or `None` if they have not registered one.
///
/// `None` is the ordinary answer, not an error: it is what "this user has not
/// connected Cursor" looks like, and both the settings surface and the harness
/// have to handle it.
///
/// # Errors
/// If the row cannot be read.
pub async fn get_cursor_api_key(
    executor: impl sqlx::PgExecutor<'_>,
    user_id: &str,
) -> anyhow::Result<Option<StoredCursorApiKey>> {
    let row = sqlx::query!(
        r#"
        SELECT
            user_id,
            key_ciphertext,
            encryption_version,
            kms_key_id,
            created_at,
            updated_at
        FROM cursor_api_keys
        WHERE user_id = $1
        "#,
        user_id,
    )
    .fetch_optional(executor)
    .await?;

    Ok(row.map(|row| StoredCursorApiKey {
        user_id: row.user_id,
        encrypted: EncryptedCursorApiKey {
            key_ciphertext: row.key_ciphertext,
            encryption_version: row.encryption_version,
            kms_key_id: row.kms_key_id,
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

/// Forget a user's key, reporting whether there was one.
///
/// This does **not** revoke anything at Cursor — the key keeps working
/// everywhere else it is used. Any surface offering to "disconnect" has to say
/// so rather than implying otherwise.
///
/// # Errors
/// If the row cannot be deleted.
pub async fn delete_cursor_api_key(
    executor: impl sqlx::PgExecutor<'_>,
    user_id: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query!("DELETE FROM cursor_api_keys WHERE user_id = $1", user_id)
        .execute(executor)
        .await?;
    Ok(result.rows_affected() > 0)
}
