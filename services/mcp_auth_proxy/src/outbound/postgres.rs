//! Postgres-backed storage for every piece of broker state.
//!
//! Each row carries its own `expires_at`. Reads ignore expired rows, so a row
//! is dead the moment it expires even if [`InflightAuthStore::cleanup_expired`]
//! has not swept it yet.
//!
//! The upstream tokens behind an issued authorization code are the only
//! credentials stored here. They are KMS-encrypted with the code's digest and
//! client in the encryption context, so a row copied under another code or
//! client does not decrypt. Codes themselves are stored as digests, like refresh
//! tokens, so reading the table yields nothing redeemable.

#[cfg(test)]
mod test;

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime},
};

use anyhow::Context;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use cursor_api_key::cipher::KmsCiphertexts;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use zeroize::Zeroizing;

use crate::domain::{
    models::{
        AccessToken, IssuedAuthorizationCode, PendingAuthorization, RefreshToken,
        RefreshTokenBinding, RegisteredClient,
    },
    ports::{
        ClientRegistrationStore, GrantRevokedFuture, RefreshTokenBindingFuture,
        RefreshTokenBindingStore, RegisteredClientFuture, StoreWriteFuture,
    },
    service::{
        AUTHORIZATION_CODE_TTL, CLIENT_REGISTRATION_TTL, InflightAuthStore, PENDING_AUTH_TTL,
        REFRESH_TOKEN_BINDING_TTL, REVOKED_GRANT_TTL,
    },
};

/// The scheme `tokens_ciphertext` is written with.
const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so no other feature's
/// ciphertext decrypts as an authorization code's tokens.
const ENCRYPTION_PURPOSE: &str = "mcp-oauth-authorization-code";

/// KMS refuses direct encryption of more than this many bytes.
const KMS_MAX_PLAINTEXT_BYTES: usize = 4096;

/// Postgres store for client registrations, refresh token bindings, and
/// in-flight handshake state.
#[derive(Clone)]
pub struct PostgresAuthStore {
    pool: PgPool,
    kms: Arc<dyn KmsCiphertexts>,
}

impl PostgresAuthStore {
    /// Creates a store over `pool`, encrypting issued code tokens with `kms`.
    pub fn new(pool: PgPool, kms: Arc<dyn KmsCiphertexts>) -> Self {
        Self { pool, kms }
    }

    /// Copies a registration from another store, keeping the time it had left.
    /// An existing row wins, so a copy can never overwrite newer state.
    pub async fn import_client(
        &self,
        client: &RegisteredClient,
        remaining: Duration,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (client_id) DO NOTHING
            "#,
            client.client_id,
            client.client_name,
            &client.redirect_uris,
            expires_at(remaining)?,
        )
        .execute(&self.pool)
        .await
        .context("failed to import client registration")?;
        Ok(())
    }

    /// Copies a refresh token binding from another store, keeping the time it
    /// had left. An existing row wins, so a copy can never overwrite newer
    /// state.
    pub async fn import_binding(
        &self,
        refresh_token_digest: &str,
        binding: &RefreshTokenBinding,
        remaining: Duration,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO mcp_oauth_refresh_token_bindings
                (refresh_token_digest, client_id, grant_id, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (refresh_token_digest) DO NOTHING
            "#,
            refresh_token_digest,
            binding.client_id,
            binding.grant_id,
            expires_at(remaining)?,
        )
        .execute(&self.pool)
        .await
        .context("failed to import refresh token binding")?;
        Ok(())
    }

    /// Copies a grant revocation from another store, keeping the time it had
    /// left. An existing row wins, so a copy can never shorten a revocation.
    pub async fn import_revoked_grant(
        &self,
        grant_id: &str,
        remaining: Duration,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO mcp_oauth_revoked_grants (grant_id, expires_at)
            VALUES ($1, $2)
            ON CONFLICT (grant_id) DO NOTHING
            "#,
            grant_id,
            expires_at(remaining)?,
        )
        .execute(&self.pool)
        .await
        .context("failed to import grant revocation")?;
        Ok(())
    }
}

fn expires_at(remaining: Duration) -> anyhow::Result<DateTime<Utc>> {
    Ok(Utc::now() + chrono::Duration::from_std(remaining).context("expiry out of range")?)
}

fn code_digest(code: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(code.as_bytes()))
}

fn encryption_context(code_digest: &str, client_id: &str) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        ("macro:code-digest".to_owned(), code_digest.to_owned()),
        ("macro:client-id".to_owned(), client_id.to_owned()),
    ])
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CodeTokens {
    access_token: AccessToken,
    refresh_token: RefreshToken,
}

impl ClientRegistrationStore for PostgresAuthStore {
    fn insert_client<'a>(&'a self, client: &'a RegisteredClient) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            sqlx::query!(
                r#"
                INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, expires_at)
                VALUES ($1, $2, $3, $4)
                "#,
                client.client_id,
                client.client_name,
                &client.redirect_uris,
                expires_at(CLIENT_REGISTRATION_TTL)?,
            )
            .execute(&self.pool)
            .await
            .context("failed to persist client registration")?;
            Ok(())
        })
    }

    fn find_client<'a>(&'a self, client_id: &'a str) -> RegisteredClientFuture<'a> {
        Box::pin(async move {
            // Reading re-arms the expiry in the same statement, so a
            // registration lapses only after going unused for the whole window.
            let row = sqlx::query!(
                r#"
                UPDATE mcp_oauth_clients
                SET expires_at = $2
                WHERE client_id = $1 AND expires_at > now()
                RETURNING client_id, client_name, redirect_uris
                "#,
                client_id,
                expires_at(CLIENT_REGISTRATION_TTL)?,
            )
            .fetch_optional(&self.pool)
            .await
            .context("failed to fetch client registration")?;
            Ok(row.map(|row| RegisteredClient {
                client_id: row.client_id,
                client_name: row.client_name,
                redirect_uris: row.redirect_uris,
            }))
        })
    }
}

impl RefreshTokenBindingStore for PostgresAuthStore {
    fn bind<'a>(
        &'a self,
        refresh_token_digest: &'a str,
        binding: &'a RefreshTokenBinding,
    ) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            sqlx::query!(
                r#"
                INSERT INTO mcp_oauth_refresh_token_bindings
                    (refresh_token_digest, client_id, grant_id, expires_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (refresh_token_digest)
                DO UPDATE SET
                    client_id = EXCLUDED.client_id,
                    grant_id = EXCLUDED.grant_id,
                    expires_at = EXCLUDED.expires_at
                "#,
                refresh_token_digest,
                binding.client_id,
                binding.grant_id,
                expires_at(REFRESH_TOKEN_BINDING_TTL)?,
            )
            .execute(&self.pool)
            .await
            .context("failed to persist refresh token binding")?;
            Ok(())
        })
    }

    fn binding<'a>(&'a self, refresh_token_digest: &'a str) -> RefreshTokenBindingFuture<'a> {
        Box::pin(async move {
            let row = sqlx::query!(
                r#"
                SELECT client_id, grant_id
                FROM mcp_oauth_refresh_token_bindings
                WHERE refresh_token_digest = $1 AND expires_at > now()
                "#,
                refresh_token_digest,
            )
            .fetch_optional(&self.pool)
            .await
            .context("failed to fetch refresh token binding")?;
            Ok(row.map(|row| RefreshTokenBinding {
                client_id: row.client_id,
                grant_id: row.grant_id,
            }))
        })
    }

    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            sqlx::query!(
                "DELETE FROM mcp_oauth_refresh_token_bindings WHERE refresh_token_digest = $1",
                refresh_token_digest,
            )
            .execute(&self.pool)
            .await
            .context("failed to delete refresh token binding")?;
            Ok(())
        })
    }

    fn revoke_grant<'a>(&'a self, grant_id: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            sqlx::query!(
                r#"
                INSERT INTO mcp_oauth_revoked_grants (grant_id, expires_at)
                VALUES ($1, $2)
                ON CONFLICT (grant_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
                "#,
                grant_id,
                expires_at(REVOKED_GRANT_TTL)?,
            )
            .execute(&self.pool)
            .await
            .context("failed to persist grant revocation")?;
            Ok(())
        })
    }

    fn is_grant_revoked<'a>(&'a self, grant_id: &'a str) -> GrantRevokedFuture<'a> {
        Box::pin(async move {
            let revoked = sqlx::query_scalar!(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM mcp_oauth_revoked_grants
                    WHERE grant_id = $1 AND expires_at > now()
                ) AS "revoked!"
                "#,
                grant_id,
            )
            .fetch_one(&self.pool)
            .await
            .context("failed to read grant revocation")?;
            Ok(revoked)
        })
    }
}

impl InflightAuthStore for PostgresAuthStore {
    async fn insert_pending(
        &self,
        session_id: &str,
        pending: PendingAuthorization,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO mcp_oauth_pending_authorizations
                (session_id, client_id, code_challenge, client_state, client_redirect_uri, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            session_id,
            pending.client_id,
            pending.code_challenge,
            pending.client_state,
            pending.client_redirect_uri,
            expires_at(PENDING_AUTH_TTL)?,
        )
        .execute(&self.pool)
        .await
        .context("failed to persist pending authorization")?;
        Ok(())
    }

    async fn take_pending(&self, session_id: &str) -> anyhow::Result<Option<PendingAuthorization>> {
        // DELETE ... RETURNING consumes the row atomically, so a session
        // completes at most once even when callbacks race.
        let row = sqlx::query!(
            r#"
            DELETE FROM mcp_oauth_pending_authorizations
            WHERE session_id = $1
            RETURNING client_id, code_challenge, client_state, client_redirect_uri, expires_at
            "#,
            session_id,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch pending authorization")?;
        Ok(row
            .filter(|row| row.expires_at > Utc::now())
            .map(|row| PendingAuthorization {
                client_id: row.client_id,
                code_challenge: row.code_challenge,
                client_state: row.client_state,
                client_redirect_uri: row.client_redirect_uri,
            }))
    }

    #[tracing::instrument(
        name = "mcp_oauth.store_code",
        skip_all,
        err,
        fields(client_id = %issued.client_id)
    )]
    async fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        let digest = code_digest(code);
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&CodeTokens {
                access_token: issued.access_token,
                refresh_token: issued.refresh_token,
            })
            .context("failed to serialize authorization code tokens")?,
        );
        anyhow::ensure!(
            plaintext.len() <= KMS_MAX_PLAINTEXT_BYTES,
            "authorization code tokens are {} bytes, over the {KMS_MAX_PLAINTEXT_BYTES} byte KMS limit",
            plaintext.len()
        );
        let (ciphertext, kms_key_id) = self
            .kms
            .encrypt(encryption_context(&digest, &issued.client_id), &plaintext)
            .await
            .context("failed to encrypt authorization code tokens")?;
        sqlx::query!(
            r#"
            INSERT INTO mcp_oauth_authorization_codes (
                code_digest, client_id, tokens_ciphertext, kms_key_id, encryption_version,
                code_challenge, redirect_uri, access_token_expires_at, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            digest,
            issued.client_id,
            ciphertext,
            kms_key_id,
            ENCRYPTION_VERSION,
            issued.code_challenge,
            issued.redirect_uri,
            DateTime::<Utc>::from(issued.access_token_expires_at),
            expires_at(AUTHORIZATION_CODE_TTL)?,
        )
        .execute(&self.pool)
        .await
        .context("failed to persist issued authorization code")?;
        Ok(())
    }

    #[tracing::instrument(name = "mcp_oauth.redeem_code", skip_all, err)]
    async fn take_issued(&self, code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        let digest = code_digest(code);
        // Consumed before decrypting: a code is single use even if the decrypt
        // that follows fails.
        let row = sqlx::query!(
            r#"
            DELETE FROM mcp_oauth_authorization_codes
            WHERE code_digest = $1
            RETURNING client_id, tokens_ciphertext, kms_key_id, encryption_version,
                code_challenge, redirect_uri, access_token_expires_at, expires_at
            "#,
            digest,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch issued authorization code")?;
        let Some(row) = row.filter(|row| row.expires_at > Utc::now()) else {
            return Ok(None);
        };
        anyhow::ensure!(
            row.encryption_version == ENCRYPTION_VERSION,
            "unsupported authorization code encryption version {}",
            row.encryption_version
        );
        let plaintext = self
            .kms
            .decrypt(
                &row.kms_key_id,
                &row.tokens_ciphertext,
                encryption_context(&digest, &row.client_id),
            )
            .await
            .context("failed to decrypt authorization code tokens")?;
        let tokens: CodeTokens = serde_json::from_slice(&plaintext)
            .context("failed to deserialize authorization code tokens")?;
        Ok(Some(IssuedAuthorizationCode {
            client_id: row.client_id,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            code_challenge: row.code_challenge,
            redirect_uri: row.redirect_uri,
            access_token_expires_at: SystemTime::from(row.access_token_expires_at),
        }))
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        let mut transaction = self.pool.begin().await.context("failed to begin cleanup")?;
        let clients = sqlx::query!("DELETE FROM mcp_oauth_clients WHERE expires_at <= now()")
            .execute(&mut *transaction)
            .await
            .context("failed to delete expired client registrations")?
            .rows_affected();
        let bindings =
            sqlx::query!("DELETE FROM mcp_oauth_refresh_token_bindings WHERE expires_at <= now()")
                .execute(&mut *transaction)
                .await
                .context("failed to delete expired refresh token bindings")?
                .rows_affected();
        let revoked_grants =
            sqlx::query!("DELETE FROM mcp_oauth_revoked_grants WHERE expires_at <= now()")
                .execute(&mut *transaction)
                .await
                .context("failed to delete expired grant revocations")?
                .rows_affected();
        let pending =
            sqlx::query!("DELETE FROM mcp_oauth_pending_authorizations WHERE expires_at <= now()")
                .execute(&mut *transaction)
                .await
                .context("failed to delete expired pending authorizations")?
                .rows_affected();
        let codes =
            sqlx::query!("DELETE FROM mcp_oauth_authorization_codes WHERE expires_at <= now()")
                .execute(&mut *transaction)
                .await
                .context("failed to delete expired authorization codes")?
                .rows_affected();
        transaction
            .commit()
            .await
            .context("failed to commit cleanup")?;
        if clients + bindings + revoked_grants + pending + codes > 0 {
            tracing::info!(
                clients,
                bindings,
                revoked_grants,
                pending,
                codes,
                "swept expired MCP OAuth state"
            );
        }
        Ok(())
    }
}
