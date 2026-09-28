//! Encrypted owner-keyed connections with cross-replica transaction locks.
use crate::domain::{
    credentials::{ConnectionState, GrantRepository, GrantTransaction},
    model::{Error, Result},
};
use cursor_api_key::cipher::KmsCiphertexts;
use std::{collections::HashMap, sync::Arc};

#[cfg(test)]
mod test;

/// PostgreSQL persistence with purpose- and owner-bound KMS ciphertext.
pub struct PgClaudeGrants<K> {
    pool: sqlx::PgPool,
    cipher: Arc<K>,
}
impl<K> PgClaudeGrants<K> {
    /// Supply the deployment's KMS transport at the composition root.
    pub fn new(pool: sqlx::PgPool, cipher: K) -> Self {
        Self {
            pool,
            cipher: Arc::new(cipher),
        }
    }
}
fn context(owner: &str, version: i16) -> HashMap<String, String> {
    HashMap::from([
        ("purpose".into(), "claude-cloud-oauth".into()),
        ("user_id".into(), owner.into()),
        ("encryption_version".into(), version.to_string()),
    ])
}
struct OwnerTransaction<K> {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    owner: String,
    state: ConnectionState,
    cipher: Arc<K>,
}
#[async_trait::async_trait]
impl<K: KmsCiphertexts + 'static> GrantRepository for PgClaudeGrants<K> {
    async fn lock(&self, owner: &str) -> Result<Box<dyn GrantTransaction>> {
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Credentials)?;
        // Transaction-scoped advisory locks also serialize absent/deleted rows.
        // The namespace prevents collisions with other services' owner locks.
        let lock_name = format!("claude-cloud-oauth:{owner}");
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            lock_name
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| Error::Credentials)?;
        let row = sqlx::query!("SELECT grant_ciphertext, kms_key_id, encryption_version FROM claude_oauth_grants WHERE user_id = $1", owner)
            .fetch_optional(&mut *transaction).await.map_err(|_| Error::Credentials)?;
        let state = match row {
            None => ConnectionState::default(),
            Some(row) => {
                if !matches!(row.encryption_version, 1 | 2) {
                    return Err(Error::Credentials);
                }
                let bytes = self
                    .cipher
                    .decrypt(
                        &row.kms_key_id,
                        &row.grant_ciphertext,
                        context(owner, row.encryption_version),
                    )
                    .await
                    .map_err(|_| Error::Credentials)?;
                if row.encryption_version == 1 {
                    // Existing encrypted grants upgrade when next written.
                    ConnectionState {
                        grant: Some(
                            serde_json::from_slice(&bytes).map_err(|_| Error::Credentials)?,
                        ),
                        ..Default::default()
                    }
                } else {
                    serde_json::from_slice(&bytes).map_err(|_| Error::Credentials)?
                }
            }
        };
        Ok(Box::new(OwnerTransaction {
            transaction,
            owner: owner.to_owned(),
            state,
            cipher: self.cipher.clone(),
        }))
    }
}
#[async_trait::async_trait]
impl<K: KmsCiphertexts + 'static> GrantTransaction for OwnerTransaction<K> {
    fn state(&mut self) -> &mut ConnectionState {
        &mut self.state
    }
    async fn commit(self: Box<Self>) -> Result<()> {
        let Self {
            mut transaction,
            owner,
            state,
            cipher,
        } = *self;
        if state.grant.is_none() && state.attempt.is_none() {
            sqlx::query!("DELETE FROM claude_oauth_grants WHERE user_id = $1", owner)
                .execute(&mut *transaction)
                .await
                .map_err(|_| Error::Credentials)?;
        } else {
            let bytes = zeroize::Zeroizing::new(
                serde_json::to_vec(&state).map_err(|_| Error::Credentials)?,
            );
            if bytes.len() > 4096 {
                return Err(Error::Credentials);
            }
            let (ciphertext, key_id) = cipher
                .encrypt(context(&owner, 2), &bytes)
                .await
                .map_err(|_| Error::Credentials)?;
            sqlx::query!("INSERT INTO claude_oauth_grants (user_id, grant_ciphertext, kms_key_id, encryption_version) VALUES ($1, $2, $3, 2) ON CONFLICT (user_id) DO UPDATE SET grant_ciphertext = EXCLUDED.grant_ciphertext, kms_key_id = EXCLUDED.kms_key_id, encryption_version = 2, updated_at = now()", owner, ciphertext, key_id)
                .execute(&mut *transaction).await.map_err(|_| Error::Credentials)?;
        }
        transaction.commit().await.map_err(|_| Error::Credentials)
    }
}
