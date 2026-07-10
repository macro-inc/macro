//! PostgreSQL webhook delivery repository.

#[cfg(test)]
#[path = "pg_delivery_repository_test.rs"]
mod pg_delivery_repository_test;

use crate::domain::{
    models::{
        PreparedWebhookDelivery, Webhook, WebhookDeliveryAttempt, WebhookDeliveryAttemptStatus,
        WebhookDeliveryStatus, WebhookEventQueueMessage, WebhookFilters, WebhookHeaders,
        WebhookHttpOutcomeDetails, WebhookStatus,
    },
    ports::WebhookDeliveryRepository,
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use std::str::FromStr;

const REDACTED_HEADER_VALUE: &str = "[REDACTED]";

/// PostgreSQL-backed implementation of [`WebhookDeliveryRepository`].
#[derive(Clone)]
pub struct PgWebhookDeliveryRepository {
    pool: PgPool,
}

impl PgWebhookDeliveryRepository {
    /// Create a webhook delivery repository backed by the supplied pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct PreparedDeliveryRow {
    delivery_id: String,
    delivery_status: String,
    attempt_count: i32,
    next_attempt_at: Option<DateTime<Utc>>,
    webhook_id: String,
    workspace_id: String,
    name: String,
    endpoint_url: String,
    signing_secret: String,
    headers: Value,
    webhook_status: String,
    is_valid: bool,
    created_by_user_id: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    filters: Value,
}

#[derive(Clone, Copy)]
struct CompletionState {
    attempt_status: WebhookDeliveryAttemptStatus,
    delivery_status: WebhookDeliveryStatus,
    next_attempt_at: Option<DateTime<Utc>>,
    delivered: bool,
}

fn new_delivery_id() -> String {
    format!("whd_{}", macro_uuid::generate_uuid_v7())
}

fn new_attempt_id() -> String {
    format!("wha_{}", macro_uuid::generate_uuid_v7())
}

fn decode_error(
    column: &str,
    message: impl Into<Box<dyn std::error::Error + Send + Sync>>,
) -> sqlx::Error {
    sqlx::Error::ColumnDecode {
        index: column.to_string(),
        source: message.into(),
    }
}

fn row_to_prepared_delivery(
    row: PreparedDeliveryRow,
) -> Result<PreparedWebhookDelivery, sqlx::Error> {
    let status = WebhookDeliveryStatus::from_str(&row.delivery_status)
        .map_err(|message| decode_error("delivery_status", message))?;
    let webhook_status = WebhookStatus::from_str(&row.webhook_status)
        .map_err(|message| decode_error("webhook_status", message))?;
    let filters = serde_json::from_value::<WebhookFilters>(row.filters)
        .map_err(|error| decode_error("filters", error))?;
    let headers = serde_json::from_value::<WebhookHeaders>(row.headers)
        .map_err(|error| decode_error("headers", error))?;
    let attempt_count =
        u32::try_from(row.attempt_count).map_err(|error| decode_error("attempt_count", error))?;

    Ok(PreparedWebhookDelivery {
        delivery_id: row.delivery_id,
        webhook: Webhook {
            id: row.webhook_id,
            workspace_id: row.workspace_id,
            name: row.name,
            endpoint_url: row.endpoint_url,
            signing_secret: row.signing_secret,
            headers,
            status: webhook_status,
            is_valid: row.is_valid,
            created_by_user_id: row.created_by_user_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            filters,
        },
        status,
        attempt_count,
        next_attempt_at: row.next_attempt_at,
    })
}

fn encode_error(error: impl std::error::Error + Send + Sync + 'static) -> sqlx::Error {
    sqlx::Error::Encode(Box::new(error))
}

fn duration_milliseconds(details: &WebhookHttpOutcomeDetails) -> Result<i32, sqlx::Error> {
    i32::try_from(details.duration.as_millis()).map_err(encode_error)
}

fn response_status(details: &WebhookHttpOutcomeDetails) -> Option<i32> {
    details.response_status.map(i32::from)
}

fn response_headers(details: &WebhookHttpOutcomeDetails) -> Result<Option<Value>, sqlx::Error> {
    details
        .response_headers_redacted
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(encode_error)
}

async fn interrupt_current_attempt(
    transaction: &mut Transaction<'_, Postgres>,
    delivery_id: &str,
    webhook_id: &str,
    attempt_count: i32,
) -> Result<(), sqlx::Error> {
    if attempt_count == 0 {
        return Ok(());
    }

    let interrupted_status = WebhookDeliveryAttemptStatus::Interrupted.as_str();
    let in_progress_status = WebhookDeliveryAttemptStatus::InProgress.as_str();
    let interrupted = sqlx::query!(
        r#"
        UPDATE webhook_delivery_attempt
        SET
            status = $3,
            completed_at = now()
        WHERE webhook_delivery_id = $1
          AND attempt_number = $2
          AND status = $4
        RETURNING completed_at AS "completed_at!"
        "#,
        delivery_id,
        attempt_count,
        interrupted_status,
        in_progress_status
    )
    .fetch_optional(&mut **transaction)
    .await?;

    if let Some(interrupted) = interrupted {
        sqlx::query!(
            r#"
            UPDATE webhook
            SET
                last_failure_at = GREATEST(COALESCE(last_failure_at, $2), $2),
                updated_at = GREATEST(updated_at, $2)
            WHERE id = $1
            "#,
            webhook_id,
            interrupted.completed_at
        )
        .execute(&mut **transaction)
        .await?;
    }

    Ok(())
}

async fn complete_attempt(
    pool: &PgPool,
    attempt: &WebhookDeliveryAttempt,
    details: &WebhookHttpOutcomeDetails,
    completion: CompletionState,
) -> Result<(), sqlx::Error> {
    let attempt_number = i32::try_from(attempt.attempt_number).map_err(encode_error)?;
    let duration_ms = duration_milliseconds(details)?;
    let response_status = response_status(details);
    let response_headers_redacted = response_headers(details)?;
    let mut transaction = pool.begin().await?;

    let delivery = sqlx::query!(
        r#"
        SELECT webhook_id, status, attempt_count
        FROM webhook_delivery
        WHERE id = $1
        FOR UPDATE
        "#,
        attempt.delivery_id
    )
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(sqlx::Error::RowNotFound)?;

    if delivery.status != WebhookDeliveryStatus::InProgress.as_str()
        || delivery.attempt_count != attempt_number
    {
        return Err(sqlx::Error::RowNotFound);
    }

    let attempt_status = completion.attempt_status.as_str();
    let in_progress_attempt_status = WebhookDeliveryAttemptStatus::InProgress.as_str();
    let completed = sqlx::query!(
        r#"
        UPDATE webhook_delivery_attempt
        SET
            status = $4,
            completed_at = now(),
            duration_ms = $5,
            response_status = $6,
            response_headers_redacted = $7,
            response_body_preview = $8,
            error_kind = $9,
            error_message = $10
        WHERE id = $1
          AND webhook_delivery_id = $2
          AND attempt_number = $3
          AND status = $11
        RETURNING completed_at AS "completed_at!"
        "#,
        attempt.attempt_id,
        attempt.delivery_id,
        attempt_number,
        attempt_status,
        duration_ms,
        response_status,
        response_headers_redacted,
        details.response_body_preview,
        details.error_kind,
        details.error_message,
        in_progress_attempt_status
    )
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(sqlx::Error::RowNotFound)?;

    let delivery_status = completion.delivery_status.as_str();
    let delivered_at = completion.delivered.then_some(completed.completed_at);
    let updated = sqlx::query!(
        r#"
        UPDATE webhook_delivery
        SET
            status = $2,
            next_attempt_at = $3,
            delivered_at = $4,
            updated_at = $5
        WHERE id = $1
          AND status = $6
          AND attempt_count = $7
        "#,
        attempt.delivery_id,
        delivery_status,
        completion.next_attempt_at,
        delivered_at,
        completed.completed_at,
        WebhookDeliveryStatus::InProgress.as_str(),
        attempt_number
    )
    .execute(&mut *transaction)
    .await?;

    if updated.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }

    if completion.delivered {
        sqlx::query!(
            r#"
            UPDATE webhook
            SET
                last_success_at = GREATEST(COALESCE(last_success_at, $2), $2),
                updated_at = GREATEST(updated_at, $2)
            WHERE id = $1
            "#,
            delivery.webhook_id,
            completed.completed_at
        )
        .execute(&mut *transaction)
        .await?;
    } else {
        sqlx::query!(
            r#"
            UPDATE webhook
            SET
                last_failure_at = GREATEST(COALESCE(last_failure_at, $2), $2),
                updated_at = GREATEST(updated_at, $2)
            WHERE id = $1
            "#,
            delivery.webhook_id,
            completed.completed_at
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await
}

impl WebhookDeliveryRepository for PgWebhookDeliveryRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, message), fields(webhook_id = %message.webhook_id, event_id = %message.event.event_id), err)]
    async fn prepare_delivery(
        &self,
        message: &WebhookEventQueueMessage,
    ) -> Result<Option<PreparedWebhookDelivery>, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let delivery_id = new_delivery_id();
        let delivery_status = WebhookDeliveryStatus::Queued.as_str();
        let event_schema_version = i32::from(message.event.schema_version);

        sqlx::query!(
            r#"
            INSERT INTO webhook_delivery (
                id,
                webhook_id,
                event_id,
                event,
                event_schema_version,
                event_occurred_at,
                event_entity_type,
                event_entity_id,
                event_ordering_key,
                status,
                request_url,
                request_headers_redacted,
                request_body
            )
            SELECT
                $1,
                w.id,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                w.endpoint_url,
                COALESCE(
                    (
                        SELECT jsonb_object_agg(header_name, $11::TEXT)
                        FROM jsonb_object_keys(w.headers) AS header_name
                    ),
                    '{}'::JSONB
                ),
                $12
            FROM webhook w
            WHERE w.id = $2
            ON CONFLICT (webhook_id, event_id) DO NOTHING
            "#,
            delivery_id,
            message.webhook_id,
            message.event.event_id,
            message.event.event_name,
            event_schema_version,
            message.event.occurred_at,
            message.event.entity_type,
            message.event.entity_id,
            message.event.ordering_key,
            delivery_status,
            REDACTED_HEADER_VALUE,
            message.event.broker_envelope
        )
        .execute(&mut *transaction)
        .await?;

        let row = sqlx::query_as!(
            PreparedDeliveryRow,
            r#"
            SELECT
                d.id AS delivery_id,
                d.status AS delivery_status,
                d.attempt_count,
                d.next_attempt_at,
                w.id AS webhook_id,
                w.workspace_id,
                w.name,
                w.endpoint_url,
                w.signing_secret,
                w.headers,
                w.status AS webhook_status,
                w.is_valid,
                w.created_by_user_id,
                w.created_at,
                w.updated_at,
                w.deleted_at,
                w.filters
            FROM webhook_delivery d
            JOIN webhook w ON w.id = d.webhook_id
            WHERE d.webhook_id = $1
              AND d.event_id = $2
            "#,
            message.webhook_id,
            message.event.event_id
        )
        .fetch_optional(&mut *transaction)
        .await?;

        transaction.commit().await?;
        row.map(row_to_prepared_delivery).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn cancel_delivery(&self, delivery_id: &str) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let delivery = sqlx::query!(
            r#"
            SELECT webhook_id, status, attempt_count
            FROM webhook_delivery
            WHERE id = $1
            FOR UPDATE
            "#,
            delivery_id
        )
        .fetch_optional(&mut *transaction)
        .await?;

        let Some(delivery) = delivery else {
            transaction.commit().await?;
            return Ok(());
        };

        let status = WebhookDeliveryStatus::from_str(&delivery.status)
            .map_err(|message| decode_error("status", message))?;
        if status.is_terminal() {
            transaction.commit().await?;
            return Ok(());
        }

        if status == WebhookDeliveryStatus::InProgress {
            interrupt_current_attempt(
                &mut transaction,
                delivery_id,
                &delivery.webhook_id,
                delivery.attempt_count,
            )
            .await?;
        }

        sqlx::query!(
            r#"
            UPDATE webhook_delivery
            SET
                status = $2,
                next_attempt_at = NULL,
                updated_at = now()
            WHERE id = $1
            "#,
            delivery_id,
            WebhookDeliveryStatus::Canceled.as_str()
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await
    }

    #[tracing::instrument(skip(self), err)]
    async fn begin_attempt(
        &self,
        delivery_id: &str,
    ) -> Result<Option<WebhookDeliveryAttempt>, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let delivery = sqlx::query!(
            r#"
            SELECT
                webhook_id,
                status,
                attempt_count,
                COALESCE(next_attempt_at <= now(), true) AS "is_due!"
            FROM webhook_delivery
            WHERE id = $1
            FOR UPDATE
            "#,
            delivery_id
        )
        .fetch_optional(&mut *transaction)
        .await?;

        let Some(delivery) = delivery else {
            transaction.commit().await?;
            return Ok(None);
        };

        let status = WebhookDeliveryStatus::from_str(&delivery.status)
            .map_err(|message| decode_error("status", message))?;
        if status.is_terminal() || !delivery.is_due {
            transaction.commit().await?;
            return Ok(None);
        }

        if status == WebhookDeliveryStatus::InProgress {
            interrupt_current_attempt(
                &mut transaction,
                delivery_id,
                &delivery.webhook_id,
                delivery.attempt_count,
            )
            .await?;
        }

        let started = sqlx::query!(
            r#"
            UPDATE webhook_delivery
            SET
                status = $2,
                attempt_count = attempt_count + 1,
                first_attempt_at = COALESCE(first_attempt_at, now()),
                last_attempt_at = now(),
                next_attempt_at = NULL,
                updated_at = now()
            WHERE id = $1
            RETURNING
                attempt_count,
                last_attempt_at AS "started_at!"
            "#,
            delivery_id,
            WebhookDeliveryStatus::InProgress.as_str()
        )
        .fetch_one(&mut *transaction)
        .await?;

        let attempt_id = new_attempt_id();
        sqlx::query!(
            r#"
            INSERT INTO webhook_delivery_attempt (
                id,
                webhook_delivery_id,
                attempt_number,
                status,
                started_at
            )
            VALUES ($1, $2, $3, $4, $5)
            "#,
            attempt_id,
            delivery_id,
            started.attempt_count,
            WebhookDeliveryAttemptStatus::InProgress.as_str(),
            started.started_at
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(Some(WebhookDeliveryAttempt {
            attempt_id,
            delivery_id: delivery_id.to_string(),
            attempt_number: u32::try_from(started.attempt_count)
                .map_err(|error| decode_error("attempt_count", error))?,
        }))
    }

    #[tracing::instrument(skip(self, details), err)]
    async fn record_success(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> Result<(), Self::Err> {
        complete_attempt(
            &self.pool,
            attempt,
            details,
            CompletionState {
                attempt_status: WebhookDeliveryAttemptStatus::Succeeded,
                delivery_status: WebhookDeliveryStatus::Delivered,
                next_attempt_at: None,
                delivered: true,
            },
        )
        .await
    }

    #[tracing::instrument(skip(self, details), err)]
    async fn record_retryable_failure(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
        next_attempt_at: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        complete_attempt(
            &self.pool,
            attempt,
            details,
            CompletionState {
                attempt_status: WebhookDeliveryAttemptStatus::RetryableFailure,
                delivery_status: WebhookDeliveryStatus::RetryScheduled,
                next_attempt_at: Some(next_attempt_at),
                delivered: false,
            },
        )
        .await
    }

    #[tracing::instrument(skip(self, details), err)]
    async fn record_permanent_failure(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> Result<(), Self::Err> {
        complete_attempt(
            &self.pool,
            attempt,
            details,
            CompletionState {
                attempt_status: WebhookDeliveryAttemptStatus::PermanentFailure,
                delivery_status: WebhookDeliveryStatus::PermanentlyFailed,
                next_attempt_at: None,
                delivered: false,
            },
        )
        .await
    }

    #[tracing::instrument(skip(self, details), err)]
    async fn record_exhaustion(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> Result<(), Self::Err> {
        complete_attempt(
            &self.pool,
            attempt,
            details,
            CompletionState {
                attempt_status: WebhookDeliveryAttemptStatus::Exhausted,
                delivery_status: WebhookDeliveryStatus::Exhausted,
                next_attempt_at: None,
                delivered: false,
            },
        )
        .await
    }
}
