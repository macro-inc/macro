//! PostgreSQL webhook repository.
#![allow(clippy::disallowed_methods)]

#[cfg(test)]
#[path = "pg_repository_test.rs"]
mod pg_repository_test;

use crate::domain::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, Webhook, WebhookHeaders, WebhookId, WebhookRule,
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
    headers_encrypted: Value,
    status: String,
    is_valid: bool,
    created_by_user_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    rule_id: String,
    rule: Value,
    rule_created_at: chrono::DateTime<chrono::Utc>,
    rule_updated_at: chrono::DateTime<chrono::Utc>,
    rule_deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn new_webhook_id() -> String {
    // Temporary prefixed UUIDv7 ids. This can be swapped for true ULIDs later.
    format!("wh_{}", macro_uuid::generate_uuid_v7())
}

fn new_rule_id() -> String {
    // Temporary prefixed UUIDv7 ids. This can be swapped for true ULIDs later.
    format!("whr_{}", macro_uuid::generate_uuid_v7())
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
        headers: parse_headers(row.headers_encrypted),
        status,
        is_valid: row.is_valid,
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        rule: WebhookRule {
            id: row.rule_id,
            webhook_id: row.id,
            workspace_id: row.workspace_id,
            rule: row.rule,
            status,
            created_at: row.rule_created_at,
            updated_at: row.rule_updated_at,
            deleted_at: row.rule_deleted_at,
        },
    })
}

async fn fetch_webhook(pool: &PgPool, webhook_id: &str) -> Result<Option<Webhook>, sqlx::Error> {
    let row = sqlx::query_as::<_, WebhookRow>(
        r#"
        SELECT
            w.id,
            w.workspace_id,
            w.name,
            w.endpoint_url,
            w.headers_encrypted,
            w.status,
            w.is_valid,
            w.created_by_user_id,
            w.created_at,
            w.updated_at,
            w.deleted_at,
            wr.id AS rule_id,
            wr.rule,
            wr.created_at AS rule_created_at,
            wr.updated_at AS rule_updated_at,
            wr.deleted_at AS rule_deleted_at
        FROM webhook w
        JOIN webhook_rule wr ON wr.webhook_id = w.id
        WHERE w.id = $1
          AND w.deleted_at IS NULL
          AND wr.deleted_at IS NULL
        "#,
    )
    .bind(webhook_id)
    .fetch_optional(pool)
    .await?;

    row.map(row_to_webhook).transpose()
}

impl WebhookRepo for PgRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, request, secret_encrypted, headers_encrypted), err)]
    async fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        request: CreateWebhookRequest,
        secret_encrypted: String,
        headers_encrypted: Value,
    ) -> Result<Webhook, Self::Err> {
        let webhook_id = new_webhook_id();
        let rule_id = new_rule_id();
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO webhook (
                id, workspace_id, name, endpoint_url, secret_encrypted, headers_encrypted,
                status, is_valid, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
            "#,
        )
        .bind(&webhook_id)
        .bind(&request.workspace_id)
        .bind(&request.name)
        .bind(&request.endpoint_url)
        .bind(secret_encrypted)
        .bind(headers_encrypted)
        .bind(WebhookStatus::Active.as_str())
        .bind(created_by_user_id.as_ref())
        .execute(transaction.as_mut())
        .await?;

        sqlx::query(
            r#"
            INSERT INTO webhook_rule (id, webhook_id, workspace_id, rule)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(rule_id)
        .bind(&webhook_id)
        .bind(&request.workspace_id)
        .bind(request.rule)
        .execute(transaction.as_mut())
        .await?;

        transaction.commit().await?;
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
        let mut transaction = self.pool.begin().await?;

        let updated = sqlx::query(
            r#"
            UPDATE webhook
            SET
                name = COALESCE($2, name),
                endpoint_url = COALESCE($3, endpoint_url),
                headers_encrypted = COALESCE($4, headers_encrypted),
                status = COALESCE($5, status),
                is_valid = CASE WHEN $3::TEXT IS NOT NULL OR $4::JSONB IS NOT NULL THEN false ELSE is_valid END,
                updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(&webhook_id)
        .bind(request.name)
        .bind(request.endpoint_url)
        .bind(headers_encrypted)
        .bind(status)
        .execute(transaction.as_mut())
        .await?;

        if updated.rows_affected() == 0 {
            transaction.commit().await?;
            return Ok(None);
        }

        if let Some(rule) = request.rule {
            sqlx::query(
                r#"
                UPDATE webhook_rule
                SET rule = $2, updated_at = now()
                WHERE webhook_id = $1 AND deleted_at IS NULL
                "#,
            )
            .bind(&webhook_id)
            .bind(rule)
            .execute(transaction.as_mut())
            .await?;
        }

        transaction.commit().await?;
        fetch_webhook(&self.pool, &webhook_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_webhook_validity(
        &self,
        webhook_id: WebhookId,
        is_valid: bool,
    ) -> Result<Option<Webhook>, Self::Err> {
        sqlx::query(
            r#"
            UPDATE webhook
            SET is_valid = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(&webhook_id)
        .bind(is_valid)
        .execute(&self.pool)
        .await?;

        fetch_webhook(&self.pool, &webhook_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn user_can_edit_workspace(
        &self,
        user_id: MacroUserIdStr<'static>,
        workspace_id: String,
    ) -> Result<bool, Self::Err> {
        // Current schema has no general workspace ownership table. For this first adapter,
        // only user-owned workspaces encoded as the caller's user id can be verified safely.
        // Team/shared workspaces return false until their ownership model is wired here.
        let exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM "User"
                WHERE id = $1 AND id = $2
            ) AS "exists!"
            "#,
        )
        .bind(user_id.as_ref())
        .bind(workspace_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(exists)
    }
}
