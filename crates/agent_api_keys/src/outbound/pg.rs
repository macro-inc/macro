#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::{
    AgentKeyError, AgentKeyRepo, AgentKeyStatus, AgentOwner, EncryptedProviderApiKey, KeyedAgent,
    ModelProvider, Result, StoredAgentKey,
};

/// Agents' keys in `agent_api_keys`, one row per agent.
#[derive(Clone)]
pub struct PgAgentKeyRepo {
    pool: PgPool,
}

impl PgAgentKeyRepo {
    /// Read and write keys through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn storage(error: impl Into<anyhow::Error>) -> AgentKeyError {
    AgentKeyError::Storage(error.into())
}

fn provider(stored: &str) -> Result<ModelProvider> {
    ModelProvider::parse(stored)
        .ok_or_else(|| storage(anyhow::anyhow!("unknown provider {stored:?}")))
}

fn owner(user_id: Option<String>, team_id: Option<Uuid>) -> Result<AgentOwner> {
    match (user_id, team_id) {
        (Some(user_id), None) => MacroUserIdStr::try_from(user_id)
            .map(AgentOwner::User)
            .map_err(|error| storage(anyhow::anyhow!("invalid owner user id: {error:?}"))),
        (None, Some(team_id)) => Ok(AgentOwner::Team(team_id)),
        _ => Err(storage(anyhow::anyhow!(
            "an agent must have exactly one owner"
        ))),
    }
}

#[async_trait::async_trait]
impl AgentKeyRepo for PgAgentKeyRepo {
    async fn upsert(
        &self,
        bot_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
        key_prefix: &str,
    ) -> Result<AgentKeyStatus> {
        let updated_at = sqlx::query_scalar!(
            r#"
            INSERT INTO agent_api_keys (
                bot_id, provider, key_ciphertext, encryption_version, kms_key_id, key_prefix
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (bot_id) DO UPDATE SET
                provider           = EXCLUDED.provider,
                key_ciphertext     = EXCLUDED.key_ciphertext,
                encryption_version = EXCLUDED.encryption_version,
                kms_key_id         = EXCLUDED.kms_key_id,
                key_prefix         = EXCLUDED.key_prefix,
                updated_at         = NOW()
            RETURNING updated_at
            "#,
            bot_id,
            provider.as_str(),
            &encrypted.key_ciphertext,
            encrypted.encryption_version,
            encrypted.kms_key_id,
            key_prefix,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;
        Ok(AgentKeyStatus {
            provider,
            updated_at,
        })
    }

    async fn status(&self, bot_id: Uuid) -> Result<Option<AgentKeyStatus>> {
        let row = sqlx::query!(
            "SELECT provider, updated_at FROM agent_api_keys WHERE bot_id = $1",
            bot_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        row.map(|row| {
            Ok(AgentKeyStatus {
                provider: provider(&row.provider)?,
                updated_at: row.updated_at,
            })
        })
        .transpose()
    }

    async fn delete(&self, bot_id: Uuid) -> Result<bool> {
        let result = sqlx::query!("DELETE FROM agent_api_keys WHERE bot_id = $1", bot_id)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(result.rows_affected() > 0)
    }

    async fn stored(&self, bot_id: Uuid) -> Result<Option<StoredAgentKey>> {
        let row = sqlx::query!(
            r#"
            SELECT
                agent_key.provider,
                agent_key.key_ciphertext,
                agent_key.encryption_version,
                agent_key.kms_key_id,
                bot.owner_user_id,
                bot.team_id,
                config.harness,
                config.default_model
            FROM agent_api_keys agent_key
            JOIN bots bot ON bot.id = agent_key.bot_id AND bot.deleted_at IS NULL
            JOIN agent_configs config ON config.bot_id = agent_key.bot_id
            WHERE agent_key.bot_id = $1
            "#,
            bot_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        row.map(|row| {
            Ok(StoredAgentKey {
                agent: KeyedAgent {
                    bot_id,
                    owner: owner(row.owner_user_id, row.team_id)?,
                    harness: row.harness,
                    model: row.default_model,
                },
                provider: provider(&row.provider)?,
                encrypted: EncryptedProviderApiKey {
                    key_ciphertext: row.key_ciphertext,
                    encryption_version: row.encryption_version,
                    kms_key_id: row.kms_key_id,
                },
            })
        })
        .transpose()
    }
}
