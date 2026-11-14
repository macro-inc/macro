//! The inbox and audit tables in MacroDB.

use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use stripe::{CustomerId, EventId, SubscriptionId};
use uuid::Uuid;

use crate::domain::audit::Mismatch;
use crate::domain::model::{
    ClaimedCursor, Consumer, EventType, ObjectSnapshot, OrderingKey, Position, ReceivedEvent,
    StoredEvent,
};
use crate::domain::ports::{AuditRepo, CursorFailure, CursorWake, InboxRepo, Inserted, Replayed};

#[cfg(test)]
mod test;

/// The `LISTEN`/`NOTIFY` channel the webhook wakes workers on.
pub const WAKE_CHANNEL: &str = "stripe_inbox";
/// The audit's single lease row.
const AUDIT_RUN: &str = "daily";

/// Postgres storage for the inbox and the audit.
#[derive(Debug, Clone)]
pub struct PgInbox {
    pool: PgPool,
}

impl PgInbox {
    /// Storage on `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A stored value the domain cannot read.
#[derive(Debug, thiserror::Error)]
pub enum PgInboxError {
    /// The query failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A stored value is invalid.
    #[error("invalid stored {0}")]
    Invalid(&'static str),
}

fn seconds(duration: chrono::Duration) -> i64 {
    duration.num_seconds()
}

fn event_types(consumer: Consumer) -> Vec<String> {
    consumer
        .event_types()
        .iter()
        .map(|event_type| event_type.as_ref().to_owned())
        .collect()
}

/// Upserts one snapshot unless the held one is newer.
async fn project(
    connection: &mut sqlx::PgConnection,
    snapshot: &ObjectSnapshot,
    source_event_id: Option<&str>,
    observed_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO stripe_objects
            (id, kind, customer_id, snapshot, deleted, source_event_id, observed_at)
        VALUES ($1, ($2::text)::stripe_object_kind, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            snapshot = EXCLUDED.snapshot,
            deleted = EXCLUDED.deleted,
            source_event_id = EXCLUDED.source_event_id,
            observed_at = EXCLUDED.observed_at,
            updated_at = now()
        WHERE stripe_objects.observed_at <= EXCLUDED.observed_at
        "#,
        snapshot.id,
        snapshot.kind.as_ref(),
        snapshot.customer,
        snapshot.snapshot,
        snapshot.deleted,
        source_event_id,
        observed_at,
    )
    .execute(connection)
    .await?;
    Ok(())
}

async fn notify(connection: &mut sqlx::PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!("SELECT pg_notify($1, '')", WAKE_CHANNEL)
        .execute(connection)
        .await?;
    Ok(())
}

impl InboxRepo for PgInbox {
    type Err = PgInboxError;

    async fn insert(
        &self,
        event: &ReceivedEvent,
        wakes: &[CursorWake],
        traceparent: Option<&str>,
        rewind_after: DateTime<Utc>,
    ) -> Result<Inserted, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let inserted = sqlx::query!(
            r#"
            INSERT INTO stripe_events
                (id, type, api_version, livemode, created_at, ordering_key, object_id,
                 payload, traceparent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING
            "#,
            event.id.as_str(),
            event.type_name,
            event.api_version,
            event.livemode,
            event.created_at,
            event.ordering_key.0,
            event.object_id,
            event.payload,
            traceparent,
        )
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if inserted == 0 {
            return Ok(Inserted::Duplicate);
        }

        if let Some(snapshot) = &event.projection {
            project(
                &mut transaction,
                snapshot,
                Some(event.id.as_str()),
                event.created_at,
            )
            .await?;
        }

        // An idle cursor becomes due now; a due one keeps the earlier time;
        // a failing one keeps its backoff. A cursor whose retries ran out is
        // re-armed from the event it is stuck on (the dependency may be
        // back); a rejected one stays dead until replayed. Every event bumps
        // the generation.
        let consumers: Vec<String> = wakes
            .iter()
            .map(|wake| wake.consumer.as_ref().to_owned())
            .collect();
        let due: Vec<DateTime<Utc>> = wakes.iter().map(|wake| wake.due_at).collect();
        sqlx::query!(
            r#"
            INSERT INTO stripe_event_cursor (consumer, ordering_key, state, next_attempt_at, generation)
            SELECT wake.consumer::stripe_consumer, $2, 'dirty', wake.due_at, 1
            FROM UNNEST($1::text[], $3::timestamptz[]) AS wake(consumer, due_at)
            ON CONFLICT (consumer, ordering_key) DO UPDATE SET
                generation = stripe_event_cursor.generation + 1,
                state = CASE
                    WHEN stripe_event_cursor.state = 'idle'
                        OR stripe_event_cursor.dead_cause = 'retries_exhausted'
                        THEN 'dirty'::stripe_cursor_state
                    ELSE stripe_event_cursor.state
                END,
                next_attempt_at = CASE
                    WHEN stripe_event_cursor.state = 'idle'
                        OR stripe_event_cursor.dead_cause = 'retries_exhausted'
                        THEN EXCLUDED.next_attempt_at
                    WHEN stripe_event_cursor.state = 'dirty'
                        THEN LEAST(stripe_event_cursor.next_attempt_at, EXCLUDED.next_attempt_at)
                    ELSE stripe_event_cursor.next_attempt_at
                END,
                attempts = CASE WHEN stripe_event_cursor.dead_cause = 'retries_exhausted'
                    THEN 0 ELSE stripe_event_cursor.attempts END,
                dead_event_id = CASE WHEN stripe_event_cursor.dead_cause = 'retries_exhausted'
                    THEN NULL ELSE stripe_event_cursor.dead_event_id END,
                dead_cause = CASE WHEN stripe_event_cursor.dead_cause = 'retries_exhausted'
                    THEN NULL ELSE stripe_event_cursor.dead_cause END,
                updated_at = now()
            "#,
            &consumers,
            event.ordering_key.0,
            &due,
        )
        .execute(&mut *transaction)
        .await?;

        // Stripe does not deliver in order: an event created before what a
        // cursor already applied moves the cursor back to just before it,
        // so it and everything after it apply again, in order (consumers
        // are idempotent). With nothing before it, the cursor starts over:
        // every event of the key sorts after this one. An event older than
        // `rewind_after` (a resend from before retention) moves nothing:
        // the events after it may have lost their payloads, and it is
        // already reflected in what the cursor applied.
        sqlx::query!(
            r#"
            UPDATE stripe_event_cursor cursor
            SET applied_at = before.created_at,
                applied_event_id = before.id,
                updated_at = now()
            FROM (SELECT 1) one
            LEFT JOIN LATERAL (
                SELECT created_at, id FROM stripe_events
                WHERE ordering_key = $1 AND (created_at, id) < ($3, $4)
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            ) before ON true
            WHERE cursor.ordering_key = $1
              AND cursor.consumer = ANY($2::text[]::stripe_consumer[])
              AND (cursor.applied_at, cursor.applied_event_id) > ($3, $4)
              AND $3 >= $5
            "#,
            event.ordering_key.0,
            &consumers,
            event.created_at,
            event.id.as_str(),
            rewind_after,
        )
        .execute(&mut *transaction)
        .await?;

        if !wakes.is_empty() {
            notify(&mut transaction).await?;
        }
        transaction.commit().await?;
        Ok(Inserted::New)
    }

    async fn claim(
        &self,
        replica: Uuid,
        limit: u32,
        lease: chrono::Duration,
    ) -> Result<Vec<ClaimedCursor>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            UPDATE stripe_event_cursor cursor
            SET locked_by = $1, locked_until = now() + $3::bigint * interval '1 second'
            FROM (
                SELECT consumer, ordering_key
                FROM stripe_event_cursor
                WHERE state IN ('dirty', 'failing')
                  AND next_attempt_at <= now()
                  AND (locked_until IS NULL OR locked_until < now())
                ORDER BY next_attempt_at
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            ) due
            WHERE cursor.consumer = due.consumer AND cursor.ordering_key = due.ordering_key
            RETURNING cursor.consumer::text AS "consumer!", cursor.ordering_key,
                cursor.applied_at, cursor.applied_event_id, cursor.attempts,
                cursor.generation, cursor.next_attempt_at
            "#,
            replica,
            i64::from(limit),
            seconds(lease),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let applied = match (row.applied_at, row.applied_event_id) {
                    (Some(at), Some(event_id)) => Some(Position {
                        at,
                        event_id: EventId::from_str(&event_id)
                            .map_err(|_| PgInboxError::Invalid("cursor event id"))?,
                    }),
                    _ => None,
                };
                Ok(ClaimedCursor {
                    consumer: Consumer::from_str(&row.consumer)
                        .map_err(|_| PgInboxError::Invalid("consumer"))?,
                    key: OrderingKey(row.ordering_key),
                    applied,
                    attempts: u32::try_from(row.attempts).unwrap_or(0),
                    generation: row.generation,
                    due_at: row.next_attempt_at,
                })
            })
            .collect()
    }

    async fn pending_events(
        &self,
        consumer: Consumer,
        key: &OrderingKey,
        after: Option<&Position>,
        limit: u32,
    ) -> Result<Vec<StoredEvent>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT id, type AS event_type, created_at, received_at, object_id, payload, traceparent
            FROM stripe_events
            WHERE ordering_key = $1
              AND type = ANY($2)
              AND (created_at, id) > (COALESCE($3, '-infinity'::timestamptz), COALESCE($4, ''))
            ORDER BY created_at, id
            LIMIT $5
            "#,
            key.0,
            &event_types(consumer),
            after.map(|position| position.at),
            after.map(|position| position.event_id.as_str()),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredEvent {
                    id: EventId::from_str(&row.id)
                        .map_err(|_| PgInboxError::Invalid("event id"))?,
                    event_type: EventType::from_str(&row.event_type)
                        .map_err(|_| PgInboxError::Invalid("event type"))?,
                    created_at: row.created_at,
                    received_at: row.received_at,
                    object_id: row.object_id,
                    payload: row.payload,
                    traceparent: row.traceparent,
                })
            })
            .collect()
    }

    async fn invoice_paid_before(
        &self,
        invoice_id: &str,
        before: &Position,
    ) -> Result<bool, Self::Err> {
        let paid = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM stripe_events
                WHERE object_id = $1
                  AND type IN ('invoice.paid', 'invoice.payment_succeeded')
                  AND (created_at, id) < ($2, $3)
            ) AS "paid!"
            "#,
            invoice_id,
            before.at,
            before.event_id.as_str(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(paid)
    }

    async fn newer_snapshot_received(
        &self,
        object_id: &str,
        after: &Position,
    ) -> Result<bool, Self::Err> {
        let newer = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM stripe_events
                WHERE object_id = $1
                  AND type LIKE 'customer.subscription.%'
                  AND (created_at, id) > ($2, $3)
            ) AS "newer!"
            "#,
            object_id,
            after.at,
            after.event_id.as_str(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(newer)
    }

    async fn advance(
        &self,
        cursor: &ClaimedCursor,
        replica: Uuid,
        to: &Position,
        lease: chrono::Duration,
    ) -> Result<bool, Self::Err> {
        let updated = sqlx::query!(
            r#"
            UPDATE stripe_event_cursor
            SET applied_at = $4,
                applied_event_id = $5,
                attempts = 0,
                state = CASE WHEN state = 'failing' THEN 'dirty'::stripe_cursor_state ELSE state END,
                last_error = NULL,
                locked_until = now() + $6::bigint * interval '1 second',
                updated_at = now()
            WHERE consumer = ($1::text)::stripe_consumer AND ordering_key = $2 AND locked_by = $3
              AND applied_at IS NOT DISTINCT FROM $7
              AND applied_event_id IS NOT DISTINCT FROM $8
            "#,
            cursor.consumer.as_ref(),
            cursor.key.0,
            replica,
            to.at,
            to.event_id.as_str(),
            seconds(lease),
            cursor.applied.as_ref().map(|position| position.at),
            cursor.applied.as_ref().map(|position| position.event_id.as_str()),
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(updated == 1)
    }

    async fn fail(
        &self,
        cursor: &ClaimedCursor,
        replica: Uuid,
        failure: &CursorFailure,
    ) -> Result<bool, Self::Err> {
        let updated = sqlx::query!(
            r#"
            UPDATE stripe_event_cursor
            SET attempts = $4,
                next_attempt_at = $5,
                last_error = $6,
                dead_event_id = $7,
                dead_cause = $8::text::stripe_dead_cause,
                state = CASE WHEN $7::text IS NULL
                    THEN 'failing'::stripe_cursor_state
                    ELSE 'dead'::stripe_cursor_state
                END,
                locked_by = NULL,
                locked_until = NULL,
                updated_at = now()
            WHERE consumer = ($1::text)::stripe_consumer AND ordering_key = $2 AND locked_by = $3
            "#,
            cursor.consumer.as_ref(),
            cursor.key.0,
            replica,
            i32::try_from(failure.attempts).unwrap_or(i32::MAX),
            failure.next_attempt_at,
            failure.error,
            failure.dead.as_ref().map(|dead| dead.event.as_str()),
            failure.dead.as_ref().map(|dead| dead.cause.as_ref()),
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(updated == 1)
    }

    async fn release(&self, cursor: &ClaimedCursor, replica: Uuid) -> Result<bool, Self::Err> {
        // An event received during the lease bumped the generation (the
        // webhook's upsert waits on this row's lock, so the comparison sees
        // it): stay due so its consumer runs again.
        let updated = sqlx::query!(
            r#"
            UPDATE stripe_event_cursor
            SET state = CASE WHEN generation = $4
                    THEN 'idle'::stripe_cursor_state
                    ELSE 'dirty'::stripe_cursor_state
                END,
                next_attempt_at = now(),
                attempts = 0,
                locked_by = NULL,
                locked_until = NULL,
                updated_at = now()
            WHERE consumer = ($1::text)::stripe_consumer AND ordering_key = $2 AND locked_by = $3
            "#,
            cursor.consumer.as_ref(),
            cursor.key.0,
            replica,
            cursor.generation,
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(updated == 1)
    }

    async fn subscription_snapshot(
        &self,
        id: &SubscriptionId,
    ) -> Result<Option<serde_json::Value>, Self::Err> {
        Ok(sqlx::query_scalar!(
            "SELECT snapshot FROM stripe_objects WHERE id = $1 AND kind = 'subscription'",
            id.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn customer_subscriptions(
        &self,
        customer: &CustomerId,
    ) -> Result<Option<Vec<serde_json::Value>>, Self::Err> {
        let listed = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM stripe_customer_listing WHERE customer_id = $1) AS "listed!""#,
            customer.as_str(),
        )
        .fetch_one(&self.pool)
        .await?;
        if !listed {
            return Ok(None);
        }
        let snapshots = sqlx::query_scalar!(
            "SELECT snapshot FROM stripe_objects WHERE customer_id = $1 AND kind = 'subscription'",
            customer.as_str(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(snapshots))
    }

    async fn customer_snapshot(
        &self,
        customer: &CustomerId,
    ) -> Result<Option<(serde_json::Value, bool)>, Self::Err> {
        let row = sqlx::query!(
            "SELECT snapshot, deleted FROM stripe_objects WHERE id = $1 AND kind = 'customer'",
            customer.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| (row.snapshot, row.deleted)))
    }

    async fn store_read(
        &self,
        snapshots: &[ObjectSnapshot],
        observed_at: DateTime<Utc>,
        listed: Option<&CustomerId>,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        for snapshot in snapshots {
            project(&mut transaction, snapshot, None, observed_at).await?;
        }
        if let Some(customer) = listed {
            sqlx::query!(
                r#"
                INSERT INTO stripe_customer_listing (customer_id, listed_at) VALUES ($1, $2)
                ON CONFLICT (customer_id) DO UPDATE SET listed_at = EXCLUDED.listed_at
                "#,
                customer.as_str(),
                observed_at,
            )
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn replay(
        &self,
        consumer: Consumer,
        key: &OrderingKey,
        skip_dead_event: bool,
    ) -> Result<Replayed, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let updated = sqlx::query!(
            r#"
            UPDATE stripe_event_cursor cursor
            SET state = 'dirty',
                attempts = 0,
                next_attempt_at = now(),
                last_error = NULL,
                applied_at = CASE WHEN $3 AND dead.id IS NOT NULL THEN dead.created_at ELSE cursor.applied_at END,
                applied_event_id = CASE WHEN $3 AND dead.id IS NOT NULL THEN dead.id ELSE cursor.applied_event_id END,
                dead_event_id = NULL,
                dead_cause = NULL,
                locked_by = NULL,
                locked_until = NULL,
                updated_at = now()
            FROM stripe_event_cursor current
            LEFT JOIN stripe_events dead ON dead.id = current.dead_event_id
            WHERE current.consumer = cursor.consumer AND current.ordering_key = cursor.ordering_key
              AND cursor.consumer = ($1::text)::stripe_consumer AND cursor.ordering_key = $2
              AND (cursor.locked_until IS NULL OR cursor.locked_until < now())
            "#,
            consumer.as_ref(),
            key.0,
            skip_dead_event,
        )
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if updated == 0 {
            let exists = sqlx::query_scalar!(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM stripe_event_cursor
                    WHERE consumer = ($1::text)::stripe_consumer AND ordering_key = $2
                ) AS "exists!"
                "#,
                consumer.as_ref(),
                key.0,
            )
            .fetch_one(&mut *transaction)
            .await?;
            return Ok(if exists {
                Replayed::Leased
            } else {
                Replayed::NotFound
            });
        }
        notify(&mut transaction).await?;
        transaction.commit().await?;
        Ok(Replayed::Rearmed)
    }
}

impl AuditRepo for PgInbox {
    type Err = PgInboxError;

    async fn claim_run(
        &self,
        replica: Uuid,
        interval: chrono::Duration,
        lease: chrono::Duration,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(sqlx::query_scalar!(
            r#"
            UPDATE stripe_audit_run
            SET run_id = $2,
                locked_by = $3,
                locked_until = now() + $5::bigint * interval '1 second',
                last_started_at = now()
            WHERE name = $1
              AND (last_finished_at IS NULL OR last_finished_at < now() - $4::bigint * interval '1 second')
              AND (locked_until IS NULL OR locked_until < now())
            RETURNING run_id AS "run_id!"
            "#,
            AUDIT_RUN,
            Uuid::now_v7(),
            replica,
            seconds(interval),
            seconds(lease),
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn finish_run(&self, replica: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE stripe_audit_run
            SET last_finished_at = now(), locked_by = NULL, locked_until = NULL
            WHERE name = $1 AND locked_by = $2
            "#,
            AUDIT_RUN,
            replica,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn stored_event_ids(&self, ids: &[EventId]) -> Result<Vec<EventId>, Self::Err> {
        let ids: Vec<String> = ids.iter().map(ToString::to_string).collect();
        let stored = sqlx::query_scalar!("SELECT id FROM stripe_events WHERE id = ANY($1)", &ids)
            .fetch_all(&self.pool)
            .await?;
        stored
            .iter()
            .map(|id| EventId::from_str(id).map_err(|_| PgInboxError::Invalid("event id")))
            .collect()
    }

    async fn received_types(&self, since: DateTime<Utc>) -> Result<Vec<String>, Self::Err> {
        Ok(sqlx::query_scalar!(
            "SELECT DISTINCT type FROM stripe_events WHERE created_at >= $1",
            since,
        )
        .fetch_all(&self.pool)
        .await?)
    }

    async fn subscription_snapshots(
        &self,
        ids: &[SubscriptionId],
    ) -> Result<Vec<(serde_json::Value, DateTime<Utc>)>, Self::Err> {
        let ids: Vec<String> = ids.iter().map(ToString::to_string).collect();
        let rows = sqlx::query!(
            "SELECT snapshot, observed_at FROM stripe_objects WHERE id = ANY($1) AND kind = 'subscription'",
            &ids,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.snapshot, row.observed_at))
            .collect())
    }

    async fn last_invoice_failed(&self, customer: &CustomerId) -> Result<bool, Self::Err> {
        let last = sqlx::query_scalar!(
            r#"
            SELECT type FROM stripe_events
            WHERE ordering_key = $1
              AND type IN ('invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed')
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            "#,
            customer.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(last.as_deref() == Some(EventType::InvoicePaymentFailed.as_ref()))
    }

    async fn dead_cursors(&self) -> Result<Vec<(Consumer, u64)>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT consumer::text AS "consumer!", count(*) AS "count!"
            FROM stripe_event_cursor
            WHERE state = 'dead'
            GROUP BY consumer
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok((
                    Consumer::from_str(&row.consumer)
                        .map_err(|_| PgInboxError::Invalid("consumer"))?,
                    u64::try_from(row.count).unwrap_or(0),
                ))
            })
            .collect()
    }

    async fn record(&self, run_id: Uuid, mismatches: &[Mismatch]) -> Result<(), Self::Err> {
        if mismatches.is_empty() {
            return Ok(());
        }
        let ids: Vec<Uuid> = mismatches.iter().map(|_| Uuid::now_v7()).collect();
        let kinds: Vec<String> = mismatches
            .iter()
            .map(|mismatch| mismatch.kind.as_ref().to_owned())
            .collect();
        let objects: Vec<String> = mismatches
            .iter()
            .map(|mismatch| mismatch.object_id.clone())
            .collect();
        let stripe_values: Vec<serde_json::Value> = mismatches
            .iter()
            .map(|mismatch| {
                mismatch
                    .stripe_value
                    .clone()
                    .unwrap_or(serde_json::Value::Null)
            })
            .collect();
        let macro_values: Vec<serde_json::Value> = mismatches
            .iter()
            .map(|mismatch| {
                mismatch
                    .macro_value
                    .clone()
                    .unwrap_or(serde_json::Value::Null)
            })
            .collect();
        sqlx::query!(
            r#"
            INSERT INTO stripe_audit_mismatch (id, run_id, kind, object_id, stripe_value, macro_value)
            SELECT finding.id, $2, finding.kind::stripe_audit_mismatch_kind, finding.object_id,
                NULLIF(finding.stripe_value, 'null'::jsonb), NULLIF(finding.macro_value, 'null'::jsonb)
            FROM UNNEST($1::uuid[], $3::text[], $4::text[], $5::jsonb[], $6::jsonb[])
                AS finding(id, kind, object_id, stripe_value, macro_value)
            "#,
            &ids,
            run_id,
            &kinds,
            &objects,
            &stripe_values,
            &macro_values,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn apply_retention(
        &self,
        clear_before: DateTime<Utc>,
        delete_before: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            "UPDATE stripe_events SET payload = NULL WHERE created_at < $1 AND payload IS NOT NULL",
            clear_before,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query!(
            "DELETE FROM stripe_events WHERE created_at < $1",
            delete_before,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query!(
            "DELETE FROM stripe_audit_mismatch WHERE found_at < $1",
            delete_before,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
