use crate::domain::{
    models::{AesKey, MacroUserIdStr, McpServerRecord, StoredCredentials},
    ports::McpServerStore,
};
use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, AeadCore, KeyInit, OsRng},
};
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;
use std::collections::HashMap;

const NONCE_LEN: usize = 12;

/// Postgres-backed [`McpServerStore`] with AES-256-GCM encryption for credentials.
#[derive(Clone)]
pub struct PgServerRepo {
    pool: PgPool,
    encryption_key: AesKey,
}

impl PgServerRepo {
    /// Wrap an existing connection pool with an AES-256-GCM encryption key.
    pub fn new(pool: PgPool, encryption_key: AesKey) -> Self {
        Self {
            pool,
            encryption_key,
        }
    }

    #[tracing::instrument(skip_all, err)]
    fn encrypt(&self, creds: &StoredCredentials) -> Result<Vec<u8>, sqlx::Error> {
        let plaintext =
            serde_json::to_vec(creds).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        self.encrypt_bytes(&plaintext)
    }

    #[tracing::instrument(skip_all, err)]
    fn encrypt_bytes(&self, plaintext: &[u8]) -> Result<Vec<u8>, sqlx::Error> {
        let cipher = Aes256Gcm::new(self.encryption_key.as_bytes().into());
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, plaintext)
            .map_err(|e| sqlx::Error::Protocol(format!("encryption failed: {e}")))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend(ciphertext);
        Ok(out)
    }

    #[tracing::instrument(skip_all, err)]
    fn decrypt(&self, data: &[u8]) -> Result<StoredCredentials, sqlx::Error> {
        let plaintext = self.decrypt_bytes(data)?;
        serde_json::from_slice(&plaintext).map_err(|e| sqlx::Error::Decode(Box::new(e)))
    }

    #[tracing::instrument(skip_all, err)]
    fn decrypt_bytes(&self, data: &[u8]) -> Result<Vec<u8>, sqlx::Error> {
        if data.len() <= NONCE_LEN {
            return Err(sqlx::Error::Decode(
                "ciphertext too short".into(),
            ));
        }
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
        let nonce: &[u8; NONCE_LEN] = nonce_bytes
            .try_into()
            .map_err(|_| sqlx::Error::Decode("invalid nonce length".into()))?;
        let cipher = Aes256Gcm::new(self.encryption_key.as_bytes().into());
        cipher.decrypt(nonce.into(), ciphertext).map_err(|e| {
            sqlx::Error::Decode(format!("decryption failed: {e}").into())
        })
    }
}

impl McpServerStore for PgServerRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip_all, err)]
    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        let encrypted: Option<Vec<u8>> = record
            .credentials
            .as_ref()
            .map(|c| self.encrypt(c))
            .transpose()?;

        let encrypted_headers: Option<Vec<u8>> = if record.headers.is_empty() {
            None
        } else {
            let headers_plain =
                serde_json::to_vec(&record.headers)
                    .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
            Some(self.encrypt_bytes(&headers_plain)?)
        };

        // Never clobber stored credentials with NULL on conflict: re-adding
        // an existing server (e.g. via the Add Server dialog) must not wipe
        // a valid OAuth grant.
        sqlx::query!(
            r#"
            INSERT INTO mcp_servers (user_id, url, server_name, credentials, enabled, headers)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, url) DO UPDATE
            SET server_name = EXCLUDED.server_name,
                credentials = COALESCE(EXCLUDED.credentials, mcp_servers.credentials),
                enabled     = EXCLUDED.enabled,
                headers     = EXCLUDED.headers,
                updated_at  = NOW()
            "#,
            record.user_id.as_ref(),
            record.url,
            record.server_name,
            encrypted.as_deref(),
            record.enabled,
            encrypted_headers.as_deref(),
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT user_id, url, server_name, credentials, enabled, headers
            FROM mcp_servers
            WHERE user_id = $1 AND url = $2
            "#,
            user_id.as_ref(),
            server_url,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|r| {
            self.to_record(
                r.user_id, r.url, r.server_name, r.credentials, r.enabled, r.headers,
            )
        })
        .transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM mcp_servers
            WHERE user_id = $1 AND url = $2
            "#,
            user_id.as_ref(),
            server_url,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT user_id, url, server_name, credentials, enabled, headers
            FROM mcp_servers
            WHERE user_id = $1
            ORDER BY created_at
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|r| {
                self.to_record(
                    r.user_id, r.url, r.server_name, r.credentials, r.enabled, r.headers,
                )
            })
            .collect()
    }
}

impl PgServerRepo {
    #[tracing::instrument(skip_all, err)]
    fn to_record(
        &self,
        user_id: String,
        url: String,
        server_name: String,
        credentials: Option<Vec<u8>>,
        enabled: bool,
        headers: Option<Vec<u8>>,
    ) -> Result<McpServerRecord, sqlx::Error> {
        let user_id = MacroUserIdStr::parse_from_str(&user_id)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
            .into_owned();

        let credentials = credentials.map(|c| self.decrypt(&c)).transpose()?;

        let headers: HashMap<String, String> = headers
            .map(|b| {
                let plaintext = self.decrypt_bytes(&b)?;
                serde_json::from_slice(&plaintext)
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))
            })
            .transpose()?
            .unwrap_or_default();

        Ok(McpServerRecord {
            user_id,
            url,
            server_name,
            credentials,
            enabled,
            headers,
        })
    }
}
