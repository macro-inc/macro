//! PostgreSQL webhook repository.
#[cfg(test)]
#[path = "pg_repository_test.rs"]
mod pg_repository_test;

use crate::domain::{
    models::{
        CreateWebhookOutcome, CreateWebhookRequest, PatchWebhookRequest, Webhook, WebhookFilters,
        WebhookHeaders, WebhookId, WebhookStatus,
    },
    ports::{WebhookRepo, WebhookWorkspaceResolver},
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
    namespace: String,
    name: String,
    endpoint_url: String,
    signing_secret: String,
    headers: Value,
    status: String,
    is_valid: bool,
    created_by_user_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    filters: Value,
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

    let filters = serde_json::from_value::<WebhookFilters>(row.filters).map_err(|err| {
        sqlx::Error::ColumnDecode {
            index: "filters".to_string(),
            source: err.into(),
        }
    })?;

    Ok(Webhook {
        id: row.id,
        workspace_id: row.workspace_id,
        namespace: row.namespace,
        name: row.name,
        endpoint_url: row.endpoint_url,
        signing_secret: row.signing_secret,
        headers: parse_headers(row.headers),
        status,
        is_valid: row.is_valid,
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        filters,
    })
}

async fn fetch_webhook(pool: &PgPool, webhook_id: &str) -> Result<Option<Webhook>, sqlx::Error> {
    let row = sqlx::query_as!(
        WebhookRow,
        r#"
        SELECT
            w.id,
            w.workspace_id,
            w.namespace,
            w.name,
            w.endpoint_url,
            w.signing_secret,
            w.headers,
            w.status,
            w.is_valid,
            w.created_by_user_id,
            w.created_at,
            w.updated_at,
            w.deleted_at,
            w.filters
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

async fn fetch_user_team_workspace_id(
    pool: &PgPool,
    user_id: MacroUserIdStr<'static>,
) -> Result<Option<String>, sqlx::Error> {
    let team_id = sqlx::query_scalar!(
        r#"
            SELECT team_id
            FROM team_user
            WHERE user_id = $1
            ORDER BY team_role DESC
            LIMIT 1
            "#,
        user_id.as_ref()
    )
    .fetch_optional(pool)
    .await?;

    Ok(team_id.map(|id| id.to_string()))
}

impl WebhookWorkspaceResolver for PgRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, people), err)]
    async fn resolve_workspace_ids(
        &self,
        people: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<String>, Self::Err> {
        let mut workspace_ids = people
            .iter()
            .map(|person| person.as_ref().to_string())
            .collect::<Vec<_>>();
        workspace_ids.sort_unstable();
        workspace_ids.dedup();

        if workspace_ids.is_empty() {
            return Ok(workspace_ids);
        }

        let team_workspace_ids = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT team_id::text AS "team_id!"
            FROM team_user
            WHERE user_id = ANY($1)
            ORDER BY team_id::text
            "#,
            &workspace_ids
        )
        .fetch_all(&self.pool)
        .await?;

        workspace_ids.extend(team_workspace_ids);
        workspace_ids.sort_unstable();
        workspace_ids.dedup();
        Ok(workspace_ids)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_team_workspace_id(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        fetch_user_team_workspace_id(&self.pool, user_id).await
    }
}

impl WebhookRepo for PgRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, request, signing_secret, headers), err)]
    async fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        workspace_id: String,
        request: CreateWebhookRequest,
        signing_secret: String,
        headers: Value,
    ) -> Result<CreateWebhookOutcome, Self::Err> {
        let webhook_id = new_webhook_id();
        let status = WebhookStatus::Active.as_str();
        let created_by_user_id = created_by_user_id.as_ref();
        let filters = serde_json::to_value(&request.filters)
            .map_err(|err| sqlx::Error::Encode(err.into()))?;
        let inserted = sqlx::query!(
            r#"
            INSERT INTO webhook (
                id, workspace_id, namespace, name, endpoint_url, signing_secret,
                headers, filters, status, is_valid, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10)
            ON CONFLICT (workspace_id, namespace) WHERE deleted_at IS NULL DO NOTHING
            "#,
            webhook_id,
            workspace_id,
            request.namespace,
            request.name,
            request.endpoint_url,
            signing_secret,
            headers,
            filters,
            status,
            created_by_user_id
        )
        .execute(&self.pool)
        .await?;

        if inserted.rows_affected() == 0 {
            return Ok(CreateWebhookOutcome::NamespaceConflict);
        }

        fetch_webhook(&self.pool, &webhook_id)
            .await?
            .map(|webhook| CreateWebhookOutcome::Created(Box::new(webhook)))
            .ok_or(sqlx::Error::RowNotFound)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_webhook(&self, webhook_id: WebhookId) -> Result<Option<Webhook>, Self::Err> {
        fetch_webhook(&self.pool, &webhook_id).await
    }

    #[tracing::instrument(skip(self, workspace_ids), err)]
    async fn list_webhooks_for_workspaces(
        &self,
        workspace_ids: Vec<String>,
    ) -> Result<Vec<Webhook>, Self::Err> {
        let rows = sqlx::query_as!(
            WebhookRow,
            r#"
            SELECT
                w.id,
                w.workspace_id,
                w.namespace,
                w.name,
                w.endpoint_url,
                w.signing_secret,
                w.headers,
                w.status,
                w.is_valid,
                w.created_by_user_id,
                w.created_at,
                w.updated_at,
                w.deleted_at,
                w.filters
            FROM webhook w
            WHERE w.workspace_id = ANY($1)
              AND w.deleted_at IS NULL
            ORDER BY w.created_at DESC, w.id DESC
            "#,
            &workspace_ids
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(row_to_webhook).collect()
    }

    #[tracing::instrument(skip(self, workspace_ids), err)]
    async fn list_active_webhooks_matching_event(
        &self,
        workspace_ids: Vec<String>,
        event: String,
        entity_id: String,
    ) -> Result<Vec<Webhook>, Self::Err> {
        let rows = sqlx::query_as!(
            WebhookRow,
            r#"
            SELECT
                w.id,
                w.workspace_id,
                w.namespace,
                w.name,
                w.endpoint_url,
                w.signing_secret,
                w.headers,
                w.status,
                w.is_valid,
                w.created_by_user_id,
                w.created_at,
                w.updated_at,
                w.deleted_at,
                w.filters
            FROM webhook w
            WHERE w.workspace_id = ANY($1)
              AND w.deleted_at IS NULL
              AND w.status = 'active'
              AND w.is_valid
              AND w.filters @> jsonb_build_array(jsonb_build_object('events', jsonb_build_array($2::text)))
              AND jsonb_path_exists(
                  w.filters,
                  '$[*] ? (@.events[*] == $event && (!exists (@.ids) || @.ids == null || @.ids[*] == $id))',
                  jsonb_build_object('event', $2::text, 'id', $3::text)
              )
            ORDER BY w.id
            "#,
            &workspace_ids,
            &event,
            &entity_id
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(row_to_webhook).collect()
    }

    #[tracing::instrument(skip(self, request), err)]
    async fn patch_webhook(
        &self,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> Result<Option<Webhook>, Self::Err> {
        let headers = request.headers.map(|headers| {
            serde_json::to_value(headers).unwrap_or_else(|_| Value::Object(Default::default()))
        });
        let status = request.status.map(WebhookStatus::as_str);
        let filters = request
            .filters
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|err| sqlx::Error::Encode(err.into()))?;
        let updated = sqlx::query!(
            r#"
            UPDATE webhook
            SET
                name = COALESCE($2, name),
                endpoint_url = COALESCE($3, endpoint_url),
                headers = COALESCE($4, headers),
                filters = COALESCE($5, filters),
                status = COALESCE($6, status),
                is_valid = CASE WHEN $3::TEXT IS NOT NULL OR $4::JSONB IS NOT NULL THEN false ELSE is_valid END,
                updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            webhook_id,
            request.name,
            request.endpoint_url,
            headers,
            filters,
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
        fetch_user_team_workspace_id(&self.pool, user_id).await
    }
}
