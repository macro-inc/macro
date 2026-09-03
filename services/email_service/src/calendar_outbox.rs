//! Durable calendar backfill publication.

use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, CalendarBackfillPayload, FinalizeBackfillPayload,
    JobScopedPayload, LinkScopedPayload,
};
use models_email::email::service::thread::ListThreadsPayload;
use sqlx::PgPool;
use sqs_client::SQS;
use uuid::Uuid;

const BATCH_SIZE: usize = 50;

struct OutboxRow {
    id: Uuid,
    backfill_job_id: Uuid,
    email_link_id: Uuid,
    kind: String,
}

struct EmailInitOutboxRow {
    id: Uuid,
    backfill_job_id: Uuid,
    email_link_id: Uuid,
    priority_pass: bool,
    refresh_existing: bool,
}

struct EmailCompletionOutboxRow {
    id: Uuid,
    backfill_job_id: Uuid,
    email_link_id: Option<Uuid>,
}

/// Continuously publish calendar outbox rows to the established email
/// backfill queue.
///
/// A row lock is held through each SQS publish. A crash after publish but
/// before commit can duplicate a message, so every consumer remains
/// idempotent by calendar job id.
#[tracing::instrument(skip(db, sqs, scheduler))]
pub async fn run<R>(
    db: PgPool,
    sqs: SQS,
    scheduler: GoogleCalendarSyncScheduler<R>,
    calendar_sync_enabled: bool,
    cancellation_token: tokio_util::sync::CancellationToken,
) where
    R: GoogleCalendarSyncRepository,
{
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
            drain_calendar(&db, &sqs)
                .await
                .inspect_err(|error| {
                    tracing::error!(error = ?error, "failed to publish calendar backfill outbox");
                })
                .ok();
        }
        drain_email_init(&db, &sqs)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to publish email backfill init outbox");
            })
            .ok();
        drain_email_completion(&db, &sqs)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to publish email completion outbox");
            })
            .ok();
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
            _ = cancellation_token.cancelled() => return,
        }
    }
}

#[tracing::instrument(skip(db, sqs), err)]
async fn drain_email_completion(db: &PgPool, sqs: &SQS) -> anyhow::Result<usize> {
    let mut published = 0;
    for _ in 0..BATCH_SIZE {
        let mut tx = db.begin().await?;
        let row = sqlx::query_as!(
            EmailCompletionOutboxRow,
            r#"
            SELECT
                outbox.id,
                outbox.backfill_job_id,
                job.link_id AS "email_link_id?"
            FROM email_backfill_completion_outbox outbox
            JOIN email_backfill_jobs job ON job.id = outbox.backfill_job_id
            WHERE outbox.published_at IS NULL
              AND job.status = 'Complete'
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
        let Some(message) = to_email_completion_message(&row) else {
            sqlx::query!(
                r#"
                UPDATE email_backfill_completion_outbox
                SET published_at = COALESCE(published_at, now()),
                    completed_at = COALESCE(completed_at, now())
                WHERE id = $1
                "#,
                row.id,
            )
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            published += 1;
            continue;
        };
        sqs.enqueue_email_backfill_message(message).await?;
        sqlx::query!(
            r#"
            UPDATE email_backfill_completion_outbox
            SET published_at = now()
            WHERE id = $1
            "#,
            row.id,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        published += 1;
    }
    Ok(published)
}

fn to_email_completion_message(row: &EmailCompletionOutboxRow) -> Option<BackfillPubsubMessage> {
    Some(BackfillPubsubMessage {
        backfill_operation: BackfillOperation::FinalizeBackfill(JobScopedPayload {
            link_id: row.email_link_id?,
            job_id: row.backfill_job_id,
            payload: FinalizeBackfillPayload {},
        }),
    })
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

#[tracing::instrument(skip(db, sqs), err)]
async fn drain_calendar(db: &PgPool, sqs: &SQS) -> anyhow::Result<usize> {
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
                sqs.enqueue_email_backfill_message(message).await?;
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

#[tracing::instrument(skip(db, sqs), err)]
async fn drain_email_init(db: &PgPool, sqs: &SQS) -> anyhow::Result<usize> {
    let mut published = 0;
    for _ in 0..BATCH_SIZE {
        let mut tx = db.begin().await?;
        let row = sqlx::query_as!(
            EmailInitOutboxRow,
            r#"
            SELECT
                outbox.id,
                outbox.backfill_job_id,
                job.link_id AS "email_link_id!",
                -- Recovery jobs skip the priority pass: the mailbox is already
                -- populated, so there is no cold-start signal to seed.
                (job.threads_requested_limit IS NULL AND NOT job.is_recovery) AS "priority_pass!",
                job.is_recovery AS "refresh_existing!"
            FROM email_backfill_init_outbox outbox
            JOIN email_backfill_jobs job ON job.id = outbox.backfill_job_id
            WHERE outbox.published_at IS NULL
              AND job.status = 'InProgress'
              AND job.initialized_at IS NOT NULL
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
        let message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::ListThreads(JobScopedPayload {
                link_id: row.email_link_id,
                job_id: row.backfill_job_id,
                payload: ListThreadsPayload {
                    next_page_token: None,
                    priority_pass: row.priority_pass,
                    refresh_existing: row.refresh_existing,
                },
            }),
        };
        sqs.enqueue_email_backfill_message(message).await?;
        sqlx::query!(
            r#"
            UPDATE email_backfill_init_outbox
            SET published_at = now()
            WHERE id = $1
            "#,
            row.id,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        published += 1;
    }
    Ok(published)
}

fn to_queue_message(row: &OutboxRow) -> anyhow::Result<BackfillPubsubMessage> {
    let scope = LinkScopedPayload {
        link_id: row.email_link_id,
        payload: CalendarBackfillPayload {
            calendar_job_id: row.backfill_job_id,
        },
    };
    let backfill_operation = match row.kind.as_str() {
        "google_calendar" => BackfillOperation::CalendarGoogleBackfill(scope),
        kind => anyhow::bail!("unsupported calendar backfill kind: {kind}"),
    };
    Ok(BackfillPubsubMessage { backfill_operation })
}

#[cfg(test)]
mod test;
use calendar_events::domain::{
    ports::GoogleCalendarSyncRepository, service::GoogleCalendarSyncScheduler,
};
use chrono::Utc;
