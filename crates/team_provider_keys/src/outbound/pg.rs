#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::{
    EncryptedProviderApiKey, ModelProvider, ProviderKeyRepo, Result, StoredMemberKey,
    TeamProviderKeyError, TeamProviderKeyStatus,
};

/// Team keys in `cursor_configs`, one row per team and provider.
#[derive(Clone)]
pub struct PgProviderKeyRepo {
    pool: PgPool,
}

impl PgProviderKeyRepo {
    /// Read and write keys through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn storage(error: sqlx::Error) -> TeamProviderKeyError {
    TeamProviderKeyError::Storage(error.into())
}

fn provider(stored: &str) -> Result<ModelProvider> {
    ModelProvider::parse(stored).ok_or_else(|| {
        TeamProviderKeyError::Storage(anyhow::anyhow!("unknown provider {stored:?}"))
    })
}

#[async_trait::async_trait]
impl ProviderKeyRepo for PgProviderKeyRepo {
    async fn upsert(
        &self,
        team_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
        key_prefix: &str,
    ) -> Result<TeamProviderKeyStatus> {
        let updated_at = sqlx::query_scalar!(
            r#"
            INSERT INTO cursor_configs (
                team_id, provider, key_ciphertext, encryption_version, kms_key_id, key_prefix
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (team_id, provider) DO UPDATE SET
                key_ciphertext     = EXCLUDED.key_ciphertext,
                encryption_version = EXCLUDED.encryption_version,
                kms_key_id         = EXCLUDED.kms_key_id,
                key_prefix         = EXCLUDED.key_prefix,
                updated_at         = NOW()
            RETURNING updated_at
            "#,
            team_id,
            provider.as_str(),
            &encrypted.key_ciphertext,
            encrypted.encryption_version,
            encrypted.kms_key_id,
            key_prefix,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;
        Ok(TeamProviderKeyStatus {
            provider,
            updated_at,
        })
    }

    async fn list(&self, team_id: Uuid) -> Result<Vec<TeamProviderKeyStatus>> {
        let rows = sqlx::query!(
            r#"
            SELECT provider, updated_at
            FROM cursor_configs
            WHERE team_id = $1
            ORDER BY provider
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        rows.into_iter()
            .map(|row| {
                Ok(TeamProviderKeyStatus {
                    provider: provider(&row.provider)?,
                    updated_at: row.updated_at,
                })
            })
            .collect()
    }

    async fn delete(&self, team_id: Uuid, provider: ModelProvider) -> Result<bool> {
        let result = sqlx::query!(
            "DELETE FROM cursor_configs WHERE team_id = $1 AND provider = $2",
            team_id,
            provider.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(result.rows_affected() > 0)
    }

    async fn for_member(
        &self,
        user: &MacroUserIdStr<'_>,
        provider: ModelProvider,
    ) -> Result<Option<StoredMemberKey>> {
        let row = sqlx::query!(
            r#"
            SELECT
                team_key.id,
                team_key.team_id AS "team_id!",
                team_key.key_ciphertext,
                team_key.encryption_version,
                team_key.kms_key_id
            FROM cursor_configs team_key
            JOIN team_user membership ON membership.team_id = team_key.team_id
            WHERE membership.user_id = $1 AND team_key.provider = $2
            ORDER BY team_key.updated_at DESC
            LIMIT 1
            "#,
            user.as_ref(),
            provider.as_str(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        Ok(row.map(|row| StoredMemberKey {
            id: row.id,
            team_id: row.team_id,
            encrypted: EncryptedProviderApiKey {
                key_ciphertext: row.key_ciphertext,
                encryption_version: row.encryption_version,
                kms_key_id: row.kms_key_id,
            },
        }))
    }

    async fn providers_for_member(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<ModelProvider>> {
        let rows = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT team_key.provider
            FROM cursor_configs team_key
            JOIN team_user membership ON membership.team_id = team_key.team_id
            WHERE membership.user_id = $1
            ORDER BY team_key.provider
            "#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        rows.iter().map(|stored| provider(stored)).collect()
    }
}
