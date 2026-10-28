//! Owner rows provide a cross-replica lock across token exchange and rotation.

use crate::domain::{
    ConnectionError, ConnectionRepository, ConnectionState, ConnectionTransaction, EncryptedState,
    StateCipher,
};
use async_trait::async_trait;
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::Arc;

/// PostgreSQL storage holds only encrypted state and the owner's identity.
pub struct PostgresRepository {
    pool: PgPool,
    cipher: Arc<dyn StateCipher>,
}
impl PostgresRepository {
    /// Compose the SQL pool and envelope cipher in the application root.
    pub fn new(pool: PgPool, cipher: Arc<dyn StateCipher>) -> Self {
        Self { pool, cipher }
    }
}
struct OwnerTransaction {
    transaction: Transaction<'static, Postgres>,
    owner: String,
    state: ConnectionState,
    cipher: Arc<dyn StateCipher>,
}
#[async_trait]
impl ConnectionRepository for PostgresRepository {
    async fn lock(&self, owner: &str) -> Result<Box<dyn ConnectionTransaction>, ConnectionError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| ConnectionError::Storage)?;
        // Insert-on-conflict and SELECT FOR UPDATE both serialize on the same natural key.
        // A disconnected row remains as a durable lock identity, with no stored secrets.
        sqlx::query!(
            "INSERT INTO codex_connections (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
            owner
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| ConnectionError::Storage)?;
        let row = sqlx::query!(
            "SELECT encrypted_state FROM codex_connections WHERE user_id = $1 FOR UPDATE",
            owner
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| ConnectionError::Storage)?;
        let state = match row.encrypted_state {
            Some(value) => {
                let envelope: EncryptedState =
                    serde_json::from_value(value).map_err(|_| ConnectionError::Encryption)?;
                self.cipher.decrypt(owner, &envelope).await?
            }
            None => ConnectionState::default(),
        };
        Ok(Box::new(OwnerTransaction {
            transaction,
            owner: owner.to_owned(),
            state,
            cipher: self.cipher.clone(),
        }))
    }
}
#[async_trait]
impl ConnectionTransaction for OwnerTransaction {
    fn state(&mut self) -> &mut ConnectionState {
        &mut self.state
    }
    async fn commit(self: Box<Self>) -> Result<(), ConnectionError> {
        let Self {
            mut transaction,
            owner,
            state,
            cipher,
        } = *self;
        let encrypted = if state.connection.is_none() && state.attempt.is_none() {
            None
        } else {
            Some(
                serde_json::to_value(cipher.encrypt(&owner, &state).await?)
                    .map_err(|_| ConnectionError::Encryption)?,
            )
        };
        sqlx::query!("UPDATE codex_connections SET encrypted_state = $2, updated_at = NOW() WHERE user_id = $1", owner, encrypted)
            .execute(&mut *transaction).await.map_err(|_| ConnectionError::Storage)?;
        transaction
            .commit()
            .await
            .map_err(|_| ConnectionError::Storage)
    }
}

#[cfg(test)]
mod test;
