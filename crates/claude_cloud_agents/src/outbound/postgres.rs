//! Encrypted owner-keyed Claude grants. No plaintext tokens are stored in SQL.
use crate::domain::{
    credentials::GrantRepository,
    model::{Credentials, Error, Result},
};
use cursor_api_key::cipher::KmsCiphertexts;
use std::collections::HashMap;

#[cfg(test)]
mod test;

/// PostgreSQL persistence with purpose- and owner-bound KMS ciphertext.
pub struct PgClaudeGrants<K> {
    pool: sqlx::PgPool,
    cipher: K,
}
impl<K> PgClaudeGrants<K> {
    /// Supply the existing local KMS transport at the composition root.
    pub fn new(pool: sqlx::PgPool, cipher: K) -> Self {
        Self { pool, cipher }
    }
}
fn context(owner: &str) -> HashMap<String, String> {
    HashMap::from([
        ("purpose".into(), "claude-cloud-oauth".into()),
        ("user_id".into(), owner.into()),
        ("encryption_version".into(), "1".into()),
    ])
}
#[async_trait::async_trait]
impl<K: KmsCiphertexts> GrantRepository for PgClaudeGrants<K> {
    async fn get(&self, owner: &str) -> Result<Option<Credentials>> {
        let row = sqlx::query!("SELECT grant_ciphertext, kms_key_id, encryption_version FROM claude_oauth_grants WHERE user_id = $1", owner)
            .fetch_optional(&self.pool).await.map_err(|_| Error::Credentials)?;
        let Some(row) = row else {
            return Ok(None);
        };
        if row.encryption_version != 1 {
            return Err(Error::Credentials);
        }
        let bytes = self
            .cipher
            .decrypt(&row.kms_key_id, &row.grant_ciphertext, context(owner))
            .await
            .map_err(|_| Error::Credentials)?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| Error::Credentials)
    }
    async fn put(&self, owner: &str, grant: &Credentials) -> Result<()> {
        let bytes =
            zeroize::Zeroizing::new(serde_json::to_vec(grant).map_err(|_| Error::Credentials)?);
        // Direct KMS encryption has a 4 KiB plaintext limit. Fail closed.
        if bytes.len() > 4096 {
            return Err(Error::Credentials);
        }
        let (ciphertext, key_id) = self
            .cipher
            .encrypt(context(owner), &bytes)
            .await
            .map_err(|_| Error::Credentials)?;
        sqlx::query!("INSERT INTO claude_oauth_grants (user_id, grant_ciphertext, kms_key_id, encryption_version) VALUES ($1, $2, $3, 1) ON CONFLICT (user_id) DO UPDATE SET grant_ciphertext = EXCLUDED.grant_ciphertext, kms_key_id = EXCLUDED.kms_key_id, encryption_version = 1, updated_at = now()", owner, ciphertext, key_id)
            .execute(&self.pool).await.map_err(|_| Error::Credentials)?;
        Ok(())
    }
    async fn delete(&self, owner: &str) -> Result<()> {
        sqlx::query!("DELETE FROM claude_oauth_grants WHERE user_id = $1", owner)
            .execute(&self.pool)
            .await
            .map_err(|_| Error::Credentials)?;
        Ok(())
    }
}
