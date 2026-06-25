//! PostgreSQL implementation of [`WebhookRepository`].
//!
//! Stores webhook configuration and its single rule. The signing secret and
//! custom headers are persisted as opaque ciphertext (`BYTEA`) — encryption is
//! the service's concern, via [`crate::domain::ports::SecretEncryptor`], so this
//! adapter never sees plaintext.
//!
//! Uses compile-time-checked `sqlx::query!`, so after applying the
//! `create_webhook_tables` migration you must run `just prepare_db` (from the
//! workspace root, against a live database) to refresh the offline `.sqlx`
//! query cache before an offline build will succeed.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::{
    ids::WebhookId,
    model::{Webhook, WebhookRule, WebhookStatus},
    ports::{
        NewRuleRecord, NewWebhookRecord, WebhookFieldsPatch, WebhookRepoError, WebhookRepository,
    },
    rule::RuleDefinition,
};

/// PostgreSQL-backed webhook repository.
#[derive(Clone)]
pub struct PgWebhookRepo {
    pool: PgPool,
}

impl PgWebhookRepo {
    /// Wrap an existing connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Load a webhook (and its rule) by id, ignoring workspace. Returns `None`
    /// for missing or soft-deleted webhooks.
    async fn get_by_id(&self, webhook_id: &WebhookId) -> Result<Option<Webhook>, WebhookRepoError> {
        let row = sqlx::query!(
            r#"
            SELECT
                workspace_id,
                owner_user_id,
                name,
                endpoint_url,
                status,
                paused_at,
                pause_reason,
                last_success_at,
                last_failure_at,
                created_by_user_id,
                created_at,
                updated_at
            FROM webhook
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            webhook_id.as_str(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx)?;

        let Some(row) = row else {
            return Ok(None);
        };

        let rule = self.get_rule(webhook_id).await?;

        Ok(Some(Webhook {
            id: webhook_id.clone(),
            workspace_id: row.workspace_id,
            owner_user_id: row.owner_user_id.map(parse_user).transpose()?,
            name: row.name,
            endpoint_url: row.endpoint_url,
            status: parse_status(&row.status)?,
            paused_at: row.paused_at,
            pause_reason: row.pause_reason,
            last_success_at: row.last_success_at,
            last_failure_at: row.last_failure_at,
            created_by_user_id: parse_user(row.created_by_user_id)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
            rule,
        }))
    }

    /// Load the webhook's single rule, if present.
    async fn get_rule(
        &self,
        webhook_id: &WebhookId,
    ) -> Result<Option<WebhookRule>, WebhookRepoError> {
        let row = sqlx::query!(
            r#"
            SELECT id, workspace_id, name, enabled, rule, created_at, updated_at
            FROM webhook_rule
            WHERE webhook_id = $1 AND deleted_at IS NULL
            "#,
            webhook_id.as_str(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx)?;

        let Some(row) = row else {
            return Ok(None);
        };

        let definition: RuleDefinition = serde_json::from_value(row.rule)
            .map_err(|e| WebhookRepoError::Storage(anyhow::anyhow!("invalid stored rule: {e}")))?;

        Ok(Some(WebhookRule {
            id: row.id.into(),
            webhook_id: webhook_id.clone(),
            workspace_id: row.workspace_id,
            name: row.name,
            enabled: row.enabled,
            definition,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }))
    }
}

impl WebhookRepository for PgWebhookRepo {
    async fn create_webhook_with_rule(
        &self,
        record: NewWebhookRecord,
    ) -> Result<Webhook, WebhookRepoError> {
        let rule_json = serde_json::to_value(&record.rule.definition).map_err(|e| {
            WebhookRepoError::Storage(anyhow::anyhow!("failed to encode rule: {e}"))
        })?;

        let mut tx = self.pool.begin().await.map_err(map_sqlx)?;

        sqlx::query!(
            r#"
            INSERT INTO webhook (
                id, workspace_id, owner_user_id, name, endpoint_url,
                secret_encrypted, headers_encrypted, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
            record.id.as_str(),
            record.workspace_id,
            record.owner_user_id.as_deref(),
            record.name,
            record.endpoint_url,
            record.secret_encrypted,
            record.headers_encrypted.as_deref(),
            record.created_by_user_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx)?;

        sqlx::query!(
            r#"
            INSERT INTO webhook_rule (id, webhook_id, workspace_id, name, enabled, rule)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            record.rule.id.as_str(),
            record.id.as_str(),
            record.rule.workspace_id,
            record.rule.name,
            record.rule.enabled,
            rule_json,
        )
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx)?;

        tx.commit().await.map_err(map_sqlx)?;

        self.get_by_id(&record.id)
            .await?
            .ok_or(WebhookRepoError::NotFound)
    }

    async fn get_webhook(
        &self,
        workspace_id: &str,
        webhook_id: &WebhookId,
    ) -> Result<Option<Webhook>, WebhookRepoError> {
        let webhook = self.get_by_id(webhook_id).await?;
        // Workspace scoping is enforced here so a webhook from another tenant is
        // indistinguishable from one that does not exist.
        Ok(webhook.filter(|webhook| webhook.workspace_id == workspace_id))
    }

    async fn update_webhook(
        &self,
        webhook_id: &WebhookId,
        patch: WebhookFieldsPatch,
    ) -> Result<Webhook, WebhookRepoError> {
        let status = patch.status.map(WebhookStatus::as_str);
        let result = sqlx::query!(
            r#"
            UPDATE webhook
            SET
                name = COALESCE($2, name),
                endpoint_url = COALESCE($3, endpoint_url),
                status = COALESCE($4, status),
                secret_encrypted = COALESCE($5, secret_encrypted),
                headers_encrypted = COALESCE($6, headers_encrypted),
                updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            webhook_id.as_str(),
            patch.name,
            patch.endpoint_url,
            status,
            patch.secret_encrypted.as_deref(),
            patch.headers_encrypted.as_deref(),
        )
        .execute(&self.pool)
        .await
        .map_err(map_sqlx)?;

        if result.rows_affected() == 0 {
            return Err(WebhookRepoError::NotFound);
        }

        self.get_by_id(webhook_id)
            .await?
            .ok_or(WebhookRepoError::NotFound)
    }

    async fn replace_rule(
        &self,
        webhook_id: &WebhookId,
        record: NewRuleRecord,
    ) -> Result<Webhook, WebhookRepoError> {
        let rule_json = serde_json::to_value(&record.definition).map_err(|e| {
            WebhookRepoError::Storage(anyhow::anyhow!("failed to encode rule: {e}"))
        })?;

        // One rule per webhook: upsert on the unique webhook_id, keeping the
        // existing row's identity but replacing its contents.
        sqlx::query!(
            r#"
            INSERT INTO webhook_rule (id, webhook_id, workspace_id, name, enabled, rule)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (webhook_id) DO UPDATE
            SET name = EXCLUDED.name,
                enabled = EXCLUDED.enabled,
                rule = EXCLUDED.rule,
                updated_at = NOW(),
                deleted_at = NULL
            "#,
            record.id.as_str(),
            webhook_id.as_str(),
            record.workspace_id,
            record.name,
            record.enabled,
            rule_json,
        )
        .execute(&self.pool)
        .await
        .map_err(map_sqlx)?;

        self.get_by_id(webhook_id)
            .await?
            .ok_or(WebhookRepoError::NotFound)
    }
}

/// Parse a stored status string, treating unknown values as storage corruption.
fn parse_status(value: &str) -> Result<WebhookStatus, WebhookRepoError> {
    WebhookStatus::from_db_str(value).ok_or_else(|| {
        WebhookRepoError::Storage(anyhow::anyhow!("unknown webhook status: {value}"))
    })
}

/// Parse a stored user id string into a typed id.
fn parse_user(value: String) -> Result<MacroUserIdStr<'static>, WebhookRepoError> {
    MacroUserIdStr::try_from(value)
        .map_err(|e| WebhookRepoError::Storage(anyhow::anyhow!("invalid stored user id: {e}")))
}

/// Map a sqlx error, surfacing unique-constraint violations as conflicts.
fn map_sqlx(error: sqlx::Error) -> WebhookRepoError {
    if let sqlx::Error::Database(db) = &error {
        if db.code().as_deref() == Some("23505") {
            return WebhookRepoError::Conflict(db.message().to_string());
        }
    }
    WebhookRepoError::Storage(error.into())
}
