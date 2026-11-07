#![deny(missing_docs)]

//! Database utilities for encrypted Microsoft OAuth grants stored in MacroDB.

use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

/// An encrypted Microsoft OAuth refresh-token envelope.
///
/// This type intentionally exposes only opaque encrypted bytes and envelope metadata.
/// Encryption, decryption, and plaintext token handling belong to the calling service.
#[derive(Clone, PartialEq, Eq)]
pub struct EncryptedMicrosoftOAuthGrant {
    refresh_token_ciphertext: Vec<u8>,
    encrypted_data_key: Vec<u8>,
    nonce: Vec<u8>,
    encryption_version: i32,
    kms_key_id: String,
}

impl EncryptedMicrosoftOAuthGrant {
    /// Creates an opaque encrypted grant envelope.
    pub fn new(
        refresh_token_ciphertext: Vec<u8>,
        encrypted_data_key: Vec<u8>,
        nonce: Vec<u8>,
        encryption_version: i32,
        kms_key_id: String,
    ) -> Self {
        Self {
            refresh_token_ciphertext,
            encrypted_data_key,
            nonce,
            encryption_version,
            kms_key_id,
        }
    }

    /// Returns the encrypted refresh-token bytes.
    pub fn refresh_token_ciphertext(&self) -> &[u8] {
        &self.refresh_token_ciphertext
    }

    /// Returns the KMS-encrypted data-key bytes.
    pub fn encrypted_data_key(&self) -> &[u8] {
        &self.encrypted_data_key
    }

    /// Returns the AES-GCM nonce.
    pub fn nonce(&self) -> &[u8] {
        &self.nonce
    }

    /// Returns the envelope encryption format version.
    pub fn encryption_version(&self) -> i32 {
        self.encryption_version
    }

    /// Returns the KMS key identifier used to create the data key.
    pub fn kms_key_id(&self) -> &str {
        &self.kms_key_id
    }
}

/// An encrypted Microsoft OAuth grant as stored in MacroDB.
pub struct StoredMicrosoftOAuthGrant {
    fusionauth_user_id: String,
    email_address: String,
    encrypted_grant: EncryptedMicrosoftOAuthGrant,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_refreshed_at: DateTime<Utc>,
}

impl StoredMicrosoftOAuthGrant {
    /// Returns the FusionAuth user that owns the grant.
    pub fn fusionauth_user_id(&self) -> &str {
        &self.fusionauth_user_id
    }

    /// Returns the normalized mailbox email address.
    pub fn email_address(&self) -> &str {
        &self.email_address
    }

    /// Returns the opaque encrypted grant envelope.
    pub fn encrypted_grant(&self) -> &EncryptedMicrosoftOAuthGrant {
        &self.encrypted_grant
    }

    /// Returns when the grant was first stored.
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    /// Returns when the stored envelope was last replaced.
    pub fn updated_at(&self) -> DateTime<Utc> {
        self.updated_at
    }

    /// Returns when the refresh-token grant was last received from Microsoft.
    pub fn last_refreshed_at(&self) -> DateTime<Utc> {
        self.last_refreshed_at
    }
}

struct MicrosoftOAuthGrantRow {
    fusionauth_user_id: String,
    email_address: String,
    refresh_token_ciphertext: Vec<u8>,
    encrypted_data_key: Vec<u8>,
    nonce: Vec<u8>,
    encryption_version: i32,
    kms_key_id: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_refreshed_at: DateTime<Utc>,
}

impl From<MicrosoftOAuthGrantRow> for StoredMicrosoftOAuthGrant {
    fn from(row: MicrosoftOAuthGrantRow) -> Self {
        Self {
            fusionauth_user_id: row.fusionauth_user_id,
            email_address: row.email_address,
            encrypted_grant: EncryptedMicrosoftOAuthGrant::new(
                row.refresh_token_ciphertext,
                row.encrypted_data_key,
                row.nonce,
                row.encryption_version,
                row.kms_key_id,
            ),
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_refreshed_at: row.last_refreshed_at,
        }
    }
}

/// Inserts an encrypted Microsoft OAuth grant or atomically replaces its complete envelope.
pub async fn upsert_microsoft_oauth_grant(
    db: &Pool<Postgres>,
    fusionauth_user_id: &str,
    email_address: &str,
    encrypted_grant: &EncryptedMicrosoftOAuthGrant,
) -> anyhow::Result<StoredMicrosoftOAuthGrant> {
    let email_address = normalize_email_address(email_address);
    let row = sqlx::query_as!(
        MicrosoftOAuthGrantRow,
        r#"
            INSERT INTO microsoft_oauth_grants (
                fusionauth_user_id,
                email_address,
                refresh_token_ciphertext,
                encrypted_data_key,
                nonce,
                encryption_version,
                kms_key_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (fusionauth_user_id, email_address) DO UPDATE SET
                refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
                encrypted_data_key = EXCLUDED.encrypted_data_key,
                nonce = EXCLUDED.nonce,
                encryption_version = EXCLUDED.encryption_version,
                kms_key_id = EXCLUDED.kms_key_id,
                updated_at = now(),
                last_refreshed_at = now()
            RETURNING
                fusionauth_user_id,
                email_address,
                refresh_token_ciphertext,
                encrypted_data_key,
                nonce,
                encryption_version,
                kms_key_id,
                created_at,
                updated_at,
                last_refreshed_at
        "#,
        fusionauth_user_id,
        email_address,
        encrypted_grant.refresh_token_ciphertext,
        encrypted_grant.encrypted_data_key,
        encrypted_grant.nonce,
        encrypted_grant.encryption_version,
        encrypted_grant.kms_key_id,
    )
    .fetch_one(db)
    .await?;

    Ok(row.into())
}

/// Fetches an encrypted Microsoft OAuth grant by owner and normalized mailbox.
pub async fn get_microsoft_oauth_grant(
    db: &Pool<Postgres>,
    fusionauth_user_id: &str,
    email_address: &str,
) -> anyhow::Result<Option<StoredMicrosoftOAuthGrant>> {
    let email_address = normalize_email_address(email_address);
    let row = sqlx::query_as!(
        MicrosoftOAuthGrantRow,
        r#"
            SELECT
                fusionauth_user_id,
                email_address,
                refresh_token_ciphertext,
                encrypted_data_key,
                nonce,
                encryption_version,
                kms_key_id,
                created_at,
                updated_at,
                last_refreshed_at
            FROM microsoft_oauth_grants
            WHERE fusionauth_user_id = $1
              AND email_address = $2
        "#,
        fusionauth_user_id,
        email_address,
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(Into::into))
}

fn normalize_email_address(email_address: &str) -> String {
    email_address.to_lowercase()
}
