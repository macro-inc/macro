//! PostgreSQL webhook repository.
#[cfg(test)]
#[path = "pg_repository_test.rs"]
mod pg_repository_test;

use crate::domain::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, Webhook, WebhookHeaders, WebhookId,
        WebhookStatus,
    },
    ports::WebhookRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use sqlx::PgPool;
use std::str::FromStr;

/// PostgreSQL-backed implementation of [`WebhookRepo`].
#[derive(Clone)]
pub struct PgRepository {
    pool: PgPool,
}

impl PgRepository {
    /// Create a new PgRepository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct WebhookRow {
    id: String,
    workspace_id: String,
    name: String,
    endpoint_url: String,
    signing_secret: String,
    headers_encrypted: Value,
    status: String,
    is_valid: bool,
    created_by_user_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    rule: Value,
}

fn new_webhook_id() -> String {
    // Temporary prefixed UUIDv7 ids. This can be swapped for true ULIDs later.
    format!("wh_{}", macro_uuid::generate_uuid_v7())
}

fn parse_headers(value: Value) -> WebhookHeaders {
    serde_json::from_value(value).unwrap_or_default()
}

fn row_to_webhook(row: WebhookRow) -> Result<Webhook, sqlx::Error> {
    let status =
        WebhookStatus::from_str(&row.status).map_err(|message| sqlx::Error::ColumnDecode {
            index: "status".to_string(),
            source: message.into(),
        })?;

    Ok(Webhook {
        id: row.id.clone(),
        workspace_id: row.workspace_id.clone(),
        name: row.name,
        endpoint_url: row.endpoint_url,
        signing_secret: row.signing_secret,
        headers: parse_headers(row.headers_encrypted),
        status,
        is_valid: row.is_valid,
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        rule: row.rule,
    })
}

async fn fetch_webhook(pool: &PgPool, webhook_id: &str) -> Result<Option<Webhook>, sqlx::Error> {
    let row = sqlx::query_as!(
        WebhookRow,
        r#"
        SELECT
            w.id,
            w.workspace_id,
            w.name,
            w.endpoint_url,
            w.signing_secret,
            w.headers_encrypted,
            w.status,
            w.is_valid,
            w.created_by_user_id,
            w.created_at,
            w.updated_at,
            w.deleted_at,
            w.rule
        FROM webhook w
        WHERE w.id = $1
          AND w.deleted_at IS NULL
        "#,
        webhook_id
    )
    .fetch_optional(pool)
    .await?;

    row.map(row_to_webhook).transpose()
}

impl WebhookRepo for PgRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, request, signing_secret, headers_encrypted), err)]
    async fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        workspace_id: String,
        request: CreateWebhookRequest,
        signing_secret: String,
        headers_encrypted: Value,
    ) -> Result<Webhook, Self::Err> {
        let webhook_id = new_webhook_id();
        let status = WebhookStatus::Active.as_str();
        let created_by_user_id = created_by_user_id.as_ref();
        sqlx::query!(
            r#"
            INSERT INTO webhook (
                id, workspace_id, name, endpoint_url, signing_secret, headers_encrypted,
                rule, status, is_valid, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
            "#,
            webhook_id,
            workspace_id,
            request.name,
            request.endpoint_url,
            signing_secret,
            headers_encrypted,
            request.rule,
            status,
            created_by_user_id
        )
        .execute(&self.pool)
        .await?;
        fetch_webhook(&self.pool, &webhook_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_webhook(&self, webhook_id: WebhookId) -> Result<Option<Webhook>, Self::Err> {
        fetch_webhook(&self.pool, &webhook_id).await
    }

    #[tracing::instrument(skip(self, request), err)]
    async fn patch_webhook(
        &self,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> Result<Option<Webhook>, Self::Err> {
        let headers_encrypted = request.headers.map(|headers| {
            serde_json::to_value(headers).unwrap_or_else(|_| Value::Object(Default::default()))
        });
        let status = request.status.map(WebhookStatus::as_str);
        let updated = sqlx::query!(
            r#"
            UPDATE webhook
            SET
                name = COALESCE($2, name),
                endpoint_url = COALESCE($3, endpoint_url),
                headers_encrypted = COALESCE($4, headers_encrypted),
                rule = COALESCE($5, rule),
                status = COALESCE($6, status),
                is_valid = CASE WHEN $3::TEXT IS NOT NULL OR $4::JSONB IS NOT NULL THEN false ELSE is_valid END,
                updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            webhook_id,
            request.name,
            request.endpoint_url,
            headers_encrypted,
            request.rule,
            status
        )
        .execute(&self.pool)
        .await?;

        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        fetch_webhook(&self.pool, &webhook_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_webhook(&self, webhook_id: WebhookId) -> Result<Option<Webhook>, Self::Err> {
        let webhook = fetch_webhook(&self.pool, &webhook_id).await?;
        if webhook.is_none() {
            return Ok(None);
        }

        sqlx::query!(
            r#"
            UPDATE webhook
            SET deleted_at = now(), updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            webhook_id
        )
        .execute(&self.pool)
        .await?;

        Ok(webhook)
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_webhook_validity(
        &self,
        webhook_id: WebhookId,
        is_valid: bool,
    ) -> Result<Option<Webhook>, Self::Err> {
        sqlx::query!(
            r#"
            UPDATE webhook
            SET is_valid = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            webhook_id,
            is_valid
        )
        .execute(&self.pool)
        .await?;

        fetch_webhook(&self.pool, &webhook_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_team_workspace_id(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        let user_id = user_id.as_ref();
        let team_id = sqlx::query_scalar!(
            r#"
            SELECT team_id
            FROM team_user
            WHERE user_id = $1
            ORDER BY team_role DESC
            LIMIT 1
            "#,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(team_id.map(|id| id.to_string()))
    }
}
