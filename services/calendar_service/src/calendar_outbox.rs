//! Durable calendar backfill publication.

use crate::backfill_queue::{CalendarBackfillMessage, CalendarBackfillQueueClient};
use calendar_events::domain::{
    changes::{CalendarChangeLogPruner, CalendarChangeLogRetention},
    ports::GoogleCalendarSyncRepository,
    service::GoogleCalendarSyncScheduler,
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

const BATCH_SIZE: usize = 50;
const CHANGE_LOG_RETENTION_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60 * 60);

struct OutboxRow {
    id: Uuid,
    backfill_job_id: Uuid,
    email_link_id: Uuid,
    kind: String,
}

/// Continuously schedule due syncs, reap wedged jobs, publish calendar outbox
/// rows to calendar's own backfill queue, and hourly prune the calendar
/// change log.
///
/// A row lock is held through each SQS publish. A crash after publish but
/// before commit can duplicate a message, so every consumer remains
/// idempotent by calendar job id.
#[tracing::instrument(skip(db, queue, scheduler, retention))]
pub async fn run<R, P>(
    db: PgPool,
    queue: CalendarBackfillQueueClient,
    scheduler: GoogleCalendarSyncScheduler<R>,
    retention: CalendarChangeLogRetention<P>,
    calendar_sync_enabled: bool,
    cancellation_token: tokio_util::sync::CancellationToken,
) where
    R: GoogleCalendarSyncRepository,
    P: CalendarChangeLogPruner,
{
    let mut next_retention = tokio::time::Instant::now();
    loop {
        if cancellation_token.is_cancelled() {
            return;
        }
        // With calendar sync disabled, outbox rows keep accumulating
        // unpublished and due syncs never re-arm — enabling the flag later
        // resumes everything without a migration.
        if calendar_sync_enabled {
            scheduler
                .run_once(Utc::now())
                .await
                .inspect_err(|error| {
                    tracing::error!(error=?error, "failed to schedule due Google Calendar syncs");
                })
                .ok();
            scheduler
                .reap_once(Utc::now())
                .await
                .inspect_err(|error| {
                    tracing::error!(error=?error, "failed to reap wedged Google Calendar syncs");
                })
                .ok();
            drain_calendar(&db, &queue)
                .await
                .inspect_err(|error| {
                    tracing::error!(error = ?error, "failed to publish calendar backfill outbox");
                })
                .ok();
            if tokio::time::Instant::now() >= next_retention {
                retention
                    .run_once(Utc::now())
                    .await
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "failed to prune the calendar change log");
                    })
                    .ok();
                next_retention = tokio::time::Instant::now() + CHANGE_LOG_RETENTION_INTERVAL;
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
            _ = cancellation_token.cancelled() => return,
        }
    }
}

/// Return a calendar backfill delivery to the outbox so the drain republishes
/// it once calendar sync is enabled again. Deliveries received while the
/// switch is off would otherwise be acked and lost.
#[tracing::instrument(skip(db), err)]
pub async fn republish_calendar_job(db: &PgPool, backfill_job_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE calendar_sync_outbox
        SET published_at = NULL
        WHERE backfill_job_id = $1
        "#,
        backfill_job_id,
    )
    .execute(db)
    .await?;
    Ok(())
}

#[tracing::instrument(skip(db, queue), err)]
async fn drain_calendar(db: &PgPool, queue: &CalendarBackfillQueueClient) -> anyhow::Result<usize> {
    let mut published = 0;
    for _ in 0..BATCH_SIZE {
        let mut tx = db.begin().await?;
        let row = sqlx::query_as!(
            OutboxRow,
            r#"
            SELECT
                outbox.id,
                outbox.backfill_job_id,
                job.email_link_id,
                job.kind
            FROM calendar_sync_outbox outbox
            JOIN calendar_backfill_jobs job ON job.id = outbox.backfill_job_id
            WHERE outbox.published_at IS NULL
            ORDER BY outbox.created_at, outbox.id
            FOR UPDATE OF outbox SKIP LOCKED
            LIMIT 1
            "#,
        )
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            tx.commit().await?;
            break;
        };

        match to_queue_message(&row) {
            Ok(message) => {
                queue.enqueue(&message).await?;
                published += 1;
            }
            Err(error) => {
                // An unmappable row must still be marked published: the drain
                // always selects the oldest unpublished row, so leaving it
                // would wedge every calendar row behind it forever.
                tracing::error!(error = ?error, outbox_id = %row.id, "skipping unmappable calendar outbox row");
            }
        }
        sqlx::query!(
            r#"
            UPDATE calendar_sync_outbox
            SET published_at = now()
            WHERE id = $1
            "#,
            row.id,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(published)
}

fn to_queue_message(row: &OutboxRow) -> anyhow::Result<CalendarBackfillMessage> {
    match row.kind.as_str() {
        "google_calendar" => Ok(CalendarBackfillMessage::GoogleCalendar {
            link_id: row.email_link_id,
            calendar_job_id: row.backfill_job_id,
        }),
        kind => anyhow::bail!("unsupported calendar backfill kind: {kind}"),
    }
}
