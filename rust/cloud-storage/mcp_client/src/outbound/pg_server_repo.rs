use crate::domain::{
    models::{AesKey, MacroUserIdStr, McpServerRecord, StoredCredentials},
    ports::McpServerStore,
};
use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, AeadCore, KeyInit, OsRng},
};
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;

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

    fn encrypt(&self, creds: &StoredCredentials) -> Result<Vec<u8>, sqlx::Error> {
        let plaintext =
            serde_json::to_vec(creds).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(self.encryption_key.as_bytes()));
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, plaintext.as_ref())
            .map_err(|e| sqlx::Error::Protocol(format!("credential encryption failed: {e}")))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend(ciphertext);
        Ok(out)
    }

    fn decrypt(&self, data: &[u8]) -> Result<StoredCredentials, sqlx::Error> {
        if data.len() <= NONCE_LEN {
            return Err(sqlx::Error::Decode(
                "credential ciphertext too short".into(),
            ));
        }
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(self.encryption_key.as_bytes()));
        let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|e| {
            sqlx::Error::Decode(format!("credential decryption failed: {e}").into())
        })?;
        serde_json::from_slice(&plaintext).map_err(|e| sqlx::Error::Decode(Box::new(e)))
    }
}

impl McpServerStore for PgServerRepo {
    type Err = sqlx::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        let encrypted: Option<Vec<u8>> = record
            .credentials
            .as_ref()
            .map(|c| self.encrypt(c))
            .transpose()?;

        sqlx::query!(
            r#"
            INSERT INTO mcp_servers (user_id, url, server_name, credentials, enabled)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, url) DO UPDATE
            SET server_name = EXCLUDED.server_name,
                credentials = EXCLUDED.credentials,
                enabled     = EXCLUDED.enabled,
                updated_at  = NOW()
            "#,
            record.user_id.as_ref(),
            record.url,
            record.server_name,
            encrypted.as_deref(),
            record.enabled,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT user_id, url, server_name, credentials, enabled
            FROM mcp_servers
            WHERE user_id = $1 AND url = $2
            "#,
            user_id.as_ref(),
            server_url,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|r| self.to_record(r.user_id, r.url, r.server_name, r.credentials, r.enabled))
            .transpose()
    }

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

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT user_id, url, server_name, credentials, enabled
            FROM mcp_servers
            WHERE user_id = $1
            ORDER BY created_at
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|r| self.to_record(r.user_id, r.url, r.server_name, r.credentials, r.enabled))
            .collect()
    }
}

impl PgServerRepo {
    fn to_record(
        &self,
        user_id: String,
        url: String,
        server_name: String,
        credentials: Option<Vec<u8>>,
        enabled: bool,
    ) -> Result<McpServerRecord, sqlx::Error> {
        let user_id = MacroUserIdStr::parse_from_str(&user_id)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
            .into_owned();

        let credentials = credentials.map(|c| self.decrypt(&c)).transpose()?;

        Ok(McpServerRecord {
            user_id,
            url,
            server_name,
            credentials,
            enabled,
        })
    }
}
