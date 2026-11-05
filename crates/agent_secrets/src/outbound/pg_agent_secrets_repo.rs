//! Postgres adapter for agent secrets.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::models::{
    AgentSecretError, AgentSecretSummary, EncryptedSecret, KmsKeyId, SecretName, StoredSecret,
};
use crate::domain::ports::AgentSecretRepository;

#[cfg(test)]
mod test;

/// Agent secret storage in MacroDB.
#[derive(Clone)]
pub struct PgAgentSecretsRepo {
    pool: PgPool,
}

impl PgAgentSecretsRepo {
    /// Builds the repository on a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentSecretRepository for PgAgentSecretsRepo {
    #[tracing::instrument(skip(self, encrypted), err)]
    async fn upsert(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        encrypted: &EncryptedSecret,
    ) -> Result<AgentSecretSummary, AgentSecretError> {
        let row = sqlx::query!(
            r#"
            INSERT INTO agent_secrets
                (agent_user_id, name, ciphertext, encryption_version, kms_key_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (agent_user_id, name) DO UPDATE SET
                ciphertext = EXCLUDED.ciphertext,
                encryption_version = EXCLUDED.encryption_version,
                kms_key_id = EXCLUDED.kms_key_id,
                updated_at = NOW()
            RETURNING name, created_at, updated_at
            "#,
            agent_user_id.as_ref(),
            name.as_str(),
            encrypted.ciphertext,
            encrypted.encryption_version,
            encrypted.kms_key_id.as_str(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(AgentSecretError::internal)?;
        Ok(AgentSecretSummary {
            name: SecretName::parse(&row.name).map_err(AgentSecretError::internal)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn get(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
    ) -> Result<Option<StoredSecret>, AgentSecretError> {
        let row = sqlx::query!(
            r#"
            SELECT name, ciphertext, encryption_version, kms_key_id, created_at, updated_at
            FROM agent_secrets
            WHERE agent_user_id = $1 AND name = $2
            "#,
            agent_user_id.as_ref(),
            name.as_str(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(AgentSecretError::internal)?;

        row.map(|row| {
            Ok(StoredSecret {
                name: SecretName::parse(&row.name).map_err(AgentSecretError::internal)?,
                encrypted: EncryptedSecret {
                    ciphertext: row.ciphertext,
                    encryption_version: row.encryption_version,
                    kms_key_id: KmsKeyId::parse(row.kms_key_id)
                        .map_err(AgentSecretError::internal)?,
                },
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn list(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<AgentSecretSummary>, AgentSecretError> {
        let rows = sqlx::query!(
            r#"
            SELECT name, created_at, updated_at
            FROM agent_secrets
            WHERE agent_user_id = $1
            ORDER BY name
            "#,
            agent_user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(AgentSecretError::internal)?;
        rows.into_iter()
            .map(|row| {
                Ok(AgentSecretSummary {
                    name: SecretName::parse(&row.name).map_err(AgentSecretError::internal)?,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
    ) -> Result<bool, AgentSecretError> {
        let deleted = sqlx::query!(
            r#"DELETE FROM agent_secrets WHERE agent_user_id = $1 AND name = $2"#,
            agent_user_id.as_ref(),
            name.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(AgentSecretError::internal)?;

        Ok(deleted.rows_affected() > 0)
    }
}
