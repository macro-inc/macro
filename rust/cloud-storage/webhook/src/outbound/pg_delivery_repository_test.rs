use super::*;
use crate::domain::{
    models::{
        NormalizedWebhookEvent, WebhookDeliveryAttemptStatus, WebhookEventQueueMessage,
        WebhookHeaders,
    },
    ports::WebhookDeliveryRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use std::{collections::BTreeMap, time::Duration};

const WEBHOOK_ID: &str = "wh_delivery_test";
const USER_ID: &str = "macro|webhook-delivery@example.com";
const ENDPOINT_URL: &str = "https://example.com/webhooks/original";
const SIGNING_SECRET: &str = "secret-never-snapshotted";

async fn insert_webhook(pool: &PgPool, deleted: bool) -> anyhow::Result<()> {
    let deleted_at = deleted.then(Utc::now);
    sqlx::query!(
        r#"
        INSERT INTO webhook (
            id,
            workspace_id,
            name,
            endpoint_url,
            signing_secret,
            headers,
            filters,
            status,
            is_valid,
            created_by_user_id,
            deleted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
        "#,
        WEBHOOK_ID,
        USER_ID,
        "Delivery test",
        ENDPOINT_URL,
        SIGNING_SECRET,
        json!({
            "Authorization": "Bearer private",
            "X-Custom": "also private",
        }),
        json!([{"events": ["document.created"]}]),
        WebhookStatus::Active.as_str(),
        USER_ID,
        deleted_at
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn message(event_id: &str, body_marker: &str) -> WebhookEventQueueMessage {
    WebhookEventQueueMessage::new(
        WEBHOOK_ID.to_string(),
        NormalizedWebhookEvent {
            event_id: event_id.to_string(),
            schema_version: 1,
            event_name: "document.created".to_string(),
            entity_type: "document".to_string(),
            entity_id: "doc_123".to_string(),
            ordering_key: "doc_123".to_string(),
            occurred_at: Utc::now(),
            broker_envelope: json!({
                "event_id": event_id,
                "marker": body_marker,
                "metadata": {"private": true},
            }),
        },
    )
}

fn outcome_details() -> WebhookHttpOutcomeDetails {
    WebhookHttpOutcomeDetails {
        duration: Duration::from_millis(125),
        response_status: Some(503),
        response_headers_redacted: Some(BTreeMap::from([
            ("Content-Type".to_string(), "[REDACTED]".to_string()),
            ("X-Request-Id".to_string(), "[REDACTED]".to_string()),
        ])),
        response_body_preview: Some("temporarily unavailable".to_string()),
        error_kind: Some("http_status".to_string()),
        error_message: Some("webhook returned HTTP 503".to_string()),
    }
}

async fn prepare(
    repository: &PgWebhookDeliveryRepository,
    event_id: &str,
) -> anyhow::Result<PreparedWebhookDelivery> {
    repository
        .prepare_delivery(&message(event_id, "original"))
        .await?
        .ok_or_else(|| anyhow::anyhow!("webhook should exist"))
}

async fn begin(
    repository: &PgWebhookDeliveryRepository,
    delivery_id: &str,
) -> anyhow::Result<WebhookDeliveryAttempt> {
    repository
        .begin_attempt(delivery_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("delivery should be ready"))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn prepare_is_idempotent_and_snapshots_redacted_request_data(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook(&pool, false).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let original_message = message("evt_idempotent", "original");

    let first = repository
        .prepare_delivery(&original_message)
        .await?
        .expect("prepared delivery");
    assert!(first.delivery_id.starts_with("whd_"));
    assert_eq!(first.status, WebhookDeliveryStatus::Queued);
    assert_eq!(first.attempt_count, 0);
    assert_eq!(first.webhook.signing_secret, SIGNING_SECRET);

    sqlx::query!(
        r#"
        UPDATE webhook
        SET
            endpoint_url = $2,
            headers = $3,
            updated_at = now()
        WHERE id = $1
        "#,
        WEBHOOK_ID,
        "https://example.com/webhooks/current",
        json!({"X-Current": "new private value"})
    )
    .execute(&pool)
    .await?;

    let current = repository
        .prepare_delivery(&message("evt_idempotent", "replacement"))
        .await?
        .expect("existing delivery");
    assert_eq!(current.delivery_id, first.delivery_id);
    assert_eq!(
        current.webhook.endpoint_url,
        "https://example.com/webhooks/current"
    );
    assert_eq!(
        current.webhook.headers,
        WebhookHeaders::from([("X-Current".to_string(), "new private value".to_string())])
    );

    let stored = sqlx::query!(
        r#"
        SELECT
            request_url,
            request_headers_redacted,
            request_body,
            event,
            event_schema_version,
            event_entity_type,
            event_entity_id,
            event_ordering_key
        FROM webhook_delivery
        WHERE webhook_id = $1 AND event_id = $2
        "#,
        WEBHOOK_ID,
        "evt_idempotent"
    )
    .fetch_one(&pool)
    .await?;
    let delivery_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM webhook_delivery WHERE webhook_id = $1 AND event_id = $2",
        WEBHOOK_ID,
        "evt_idempotent"
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(delivery_count, Some(1));
    assert_eq!(stored.request_url, ENDPOINT_URL);
    assert_eq!(
        stored.request_headers_redacted,
        json!({
            "Authorization": REDACTED_HEADER_VALUE,
            "X-Custom": REDACTED_HEADER_VALUE,
        })
    );
    assert_eq!(stored.request_body, original_message.event.broker_envelope);
    assert_eq!(stored.event, "document.created");
    assert_eq!(stored.event_schema_version, 1);
    assert_eq!(stored.event_entity_type, "document");
    assert_eq!(stored.event_entity_id, "doc_123");
    assert_eq!(stored.event_ordering_key, "doc_123");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn prepare_returns_none_for_a_missing_webhook(pool: PgPool) -> anyhow::Result<()> {
    let repository = PgWebhookDeliveryRepository::new(pool.clone());

    assert!(
        repository
            .prepare_delivery(&message("evt_missing", "original"))
            .await?
            .is_none()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM webhook_delivery")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retry_scheduling_blocks_early_attempts_and_attempt_numbers_increase(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook(&pool, false).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let prepared = prepare(&repository, "evt_retry").await?;
    let first_attempt = begin(&repository, &prepared.delivery_id).await?;
    assert!(first_attempt.attempt_id.starts_with("wha_"));
    assert_eq!(first_attempt.attempt_number, 1);

    let next_attempt_at = Utc::now() + chrono::Duration::hours(1);
    repository
        .record_retryable_failure(&first_attempt, &outcome_details(), next_attempt_at)
        .await?;

    let scheduled = repository
        .prepare_delivery(&message("evt_retry", "duplicate"))
        .await?
        .expect("scheduled delivery");
    assert_eq!(scheduled.status, WebhookDeliveryStatus::RetryScheduled);
    assert_eq!(scheduled.attempt_count, 1);
    assert!(
        scheduled
            .next_attempt_at
            .is_some_and(|due| due > Utc::now())
    );
    assert!(
        repository
            .begin_attempt(&prepared.delivery_id)
            .await?
            .is_none()
    );

    sqlx::query!(
        r#"
        UPDATE webhook_delivery
        SET next_attempt_at = now() - INTERVAL '1 second'
        WHERE id = $1
        "#,
        prepared.delivery_id
    )
    .execute(&pool)
    .await?;

    let second_attempt = begin(&repository, &prepared.delivery_id).await?;
    assert_eq!(second_attempt.attempt_number, 2);
    assert_ne!(second_attempt.attempt_id, first_attempt.attempt_id);

    let state = sqlx::query!(
        r#"
        SELECT attempt_count, first_attempt_at, last_attempt_at, next_attempt_at
        FROM webhook_delivery
        WHERE id = $1
        "#,
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;
    let attempts = sqlx::query!(
        r#"
        SELECT attempt_number, status
        FROM webhook_delivery_attempt
        WHERE webhook_delivery_id = $1
        ORDER BY attempt_number
        "#,
        prepared.delivery_id
    )
    .fetch_all(&pool)
    .await?;
    let aggregate = sqlx::query!(
        "SELECT last_failure_at FROM webhook WHERE id = $1",
        WEBHOOK_ID
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(state.attempt_count, 2);
    assert!(state.first_attempt_at.is_some());
    assert!(state.last_attempt_at >= state.first_attempt_at);
    assert!(state.next_attempt_at.is_none());
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0].attempt_number, 1);
    assert_eq!(
        attempts[0].status,
        WebhookDeliveryAttemptStatus::RetryableFailure.as_str()
    );
    assert_eq!(attempts[1].attempt_number, 2);
    assert_eq!(
        attempts[1].status,
        WebhookDeliveryAttemptStatus::InProgress.as_str()
    );
    assert!(aggregate.last_failure_at.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soft_deleted_webhook_delivery_can_be_canceled_without_an_attempt(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook(&pool, true).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let prepared = prepare(&repository, "evt_canceled").await?;
    assert!(prepared.webhook.deleted_at.is_some());

    repository.cancel_delivery(&prepared.delivery_id).await?;
    repository.cancel_delivery(&prepared.delivery_id).await?;

    let delivery = sqlx::query!(
        "SELECT status, attempt_count FROM webhook_delivery WHERE id = $1",
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;
    let attempt_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM webhook_delivery_attempt WHERE webhook_delivery_id = $1",
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;
    let aggregate = sqlx::query!(
        "SELECT last_success_at, last_failure_at FROM webhook WHERE id = $1",
        WEBHOOK_ID
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(delivery.status, WebhookDeliveryStatus::Canceled.as_str());
    assert_eq!(delivery.attempt_count, 0);
    assert_eq!(attempt_count, Some(0));
    assert!(aggregate.last_success_at.is_none());
    assert!(aggregate.last_failure_at.is_none());
    assert!(
        repository
            .begin_attempt(&prepared.delivery_id)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn success_is_terminal_and_updates_success_aggregate_atomically(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook(&pool, false).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let prepared = prepare(&repository, "evt_success").await?;
    let attempt = begin(&repository, &prepared.delivery_id).await?;
    let mut details = outcome_details();
    details.response_status = Some(204);
    details.error_kind = None;
    details.error_message = None;

    repository.record_success(&attempt, &details).await?;

    let duplicate = repository
        .prepare_delivery(&message("evt_success", "redelivery"))
        .await?
        .expect("terminal delivery");
    assert_eq!(duplicate.delivery_id, prepared.delivery_id);
    assert_eq!(duplicate.status, WebhookDeliveryStatus::Delivered);
    assert!(
        repository
            .begin_attempt(&prepared.delivery_id)
            .await?
            .is_none()
    );

    let state = sqlx::query!(
        r#"
        SELECT
            d.status,
            d.delivered_at,
            d.attempt_count,
            a.status AS attempt_status,
            a.completed_at,
            w.last_success_at,
            w.last_failure_at
        FROM webhook_delivery d
        JOIN webhook_delivery_attempt a ON a.webhook_delivery_id = d.id
        JOIN webhook w ON w.id = d.webhook_id
        WHERE d.id = $1
        "#,
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(state.status, WebhookDeliveryStatus::Delivered.as_str());
    assert_eq!(state.attempt_count, 1);
    assert_eq!(
        state.attempt_status,
        WebhookDeliveryAttemptStatus::Succeeded.as_str()
    );
    assert!(state.delivered_at.is_some());
    assert_eq!(state.delivered_at, state.completed_at);
    assert_eq!(state.delivered_at, state.last_success_at);
    assert!(state.last_failure_at.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn permanent_failure_is_terminal_and_updates_failure_aggregate(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook(&pool, false).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let prepared = prepare(&repository, "evt_permanent").await?;
    let attempt = begin(&repository, &prepared.delivery_id).await?;

    repository
        .record_permanent_failure(&attempt, &outcome_details())
        .await?;

    let state = sqlx::query!(
        r#"
        SELECT
            d.status,
            d.delivered_at,
            a.status AS attempt_status,
            a.completed_at,
            a.duration_ms,
            a.response_status,
            a.response_headers_redacted,
            a.response_body_preview,
            a.error_kind,
            a.error_message,
            w.last_success_at,
            w.last_failure_at
        FROM webhook_delivery d
        JOIN webhook_delivery_attempt a ON a.webhook_delivery_id = d.id
        JOIN webhook w ON w.id = d.webhook_id
        WHERE d.id = $1
        "#,
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(
        state.status,
        WebhookDeliveryStatus::PermanentlyFailed.as_str()
    );
    assert_eq!(
        state.attempt_status,
        WebhookDeliveryAttemptStatus::PermanentFailure.as_str()
    );
    assert!(state.delivered_at.is_none());
    assert_eq!(state.duration_ms, Some(125));
    assert_eq!(state.response_status, Some(503));
    assert_eq!(
        state.response_headers_redacted,
        Some(json!({
            "Content-Type": "[REDACTED]",
            "X-Request-Id": "[REDACTED]",
        }))
    );
    assert_eq!(
        state.response_body_preview.as_deref(),
        Some("temporarily unavailable")
    );
    assert_eq!(state.error_kind.as_deref(), Some("http_status"));
    assert_eq!(
        state.error_message.as_deref(),
        Some("webhook returned HTTP 503")
    );
    assert_eq!(state.completed_at, state.last_failure_at);
    assert!(state.last_success_at.is_none());
    assert!(
        repository
            .begin_attempt(&prepared.delivery_id)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn exhaustion_is_terminal_and_updates_failure_aggregate(pool: PgPool) -> anyhow::Result<()> {
    insert_webhook(&pool, false).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let prepared = prepare(&repository, "evt_exhausted").await?;
    let attempt = begin(&repository, &prepared.delivery_id).await?;

    repository
        .record_exhaustion(&attempt, &outcome_details())
        .await?;

    let state = sqlx::query!(
        r#"
        SELECT
            d.status,
            d.next_attempt_at,
            a.status AS attempt_status,
            a.completed_at,
            w.last_failure_at
        FROM webhook_delivery d
        JOIN webhook_delivery_attempt a ON a.webhook_delivery_id = d.id
        JOIN webhook w ON w.id = d.webhook_id
        WHERE d.id = $1
        "#,
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(state.status, WebhookDeliveryStatus::Exhausted.as_str());
    assert_eq!(
        state.attempt_status,
        WebhookDeliveryAttemptStatus::Exhausted.as_str()
    );
    assert!(state.next_attempt_at.is_none());
    assert_eq!(state.completed_at, state.last_failure_at);
    assert!(
        repository
            .begin_attempt(&prepared.delivery_id)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn interrupted_attempt_is_recorded_and_recovered_monotonically(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook(&pool, false).await?;
    let repository = PgWebhookDeliveryRepository::new(pool.clone());
    let prepared = prepare(&repository, "evt_interrupted").await?;
    let interrupted_attempt = begin(&repository, &prepared.delivery_id).await?;

    let recovered_attempt = begin(&repository, &prepared.delivery_id).await?;
    assert_eq!(interrupted_attempt.attempt_number, 1);
    assert_eq!(recovered_attempt.attempt_number, 2);

    let attempts = sqlx::query!(
        r#"
        SELECT attempt_number, status, completed_at
        FROM webhook_delivery_attempt
        WHERE webhook_delivery_id = $1
        ORDER BY attempt_number
        "#,
        prepared.delivery_id
    )
    .fetch_all(&pool)
    .await?;
    let aggregate = sqlx::query!(
        "SELECT last_failure_at FROM webhook WHERE id = $1",
        WEBHOOK_ID
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(attempts.len(), 2);
    assert_eq!(
        attempts[0].status,
        WebhookDeliveryAttemptStatus::Interrupted.as_str()
    );
    assert!(attempts[0].completed_at.is_some());
    assert_eq!(attempts[0].completed_at, aggregate.last_failure_at);
    assert_eq!(
        attempts[1].status,
        WebhookDeliveryAttemptStatus::InProgress.as_str()
    );
    assert!(attempts[1].completed_at.is_none());

    let stale_result = repository
        .record_success(&interrupted_attempt, &outcome_details())
        .await;
    assert!(matches!(stale_result, Err(sqlx::Error::RowNotFound)));

    let before_completion = sqlx::query!(
        "SELECT status, attempt_count FROM webhook_delivery WHERE id = $1",
        prepared.delivery_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        before_completion.status,
        WebhookDeliveryStatus::InProgress.as_str()
    );
    assert_eq!(before_completion.attempt_count, 2);

    repository
        .record_success(&recovered_attempt, &outcome_details())
        .await?;
    let recovered = repository
        .prepare_delivery(&message("evt_interrupted", "redelivery"))
        .await?
        .expect("recovered delivery");
    assert_eq!(recovered.status, WebhookDeliveryStatus::Delivered);
    assert_eq!(recovered.attempt_count, 2);
    Ok(())
}
