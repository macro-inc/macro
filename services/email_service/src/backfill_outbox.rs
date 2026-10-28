//! Durable publication of email backfill outbox rows.

use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, FinalizeBackfillPayload, JobScopedPayload,
};
use models_email::email::service::thread::ListThreadsPayload;
use sqlx::PgPool;
use sqs_client::SQS;
use uuid::Uuid;

const BATCH_SIZE: usize = 50;

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

/// Continuously publish email backfill init and completion outbox rows to
/// the email backfill queue.
///
/// A row lock is held through each SQS publish. A crash after publish but
/// before commit can duplicate a message, so every consumer remains
/// idempotent by backfill job id.
#[tracing::instrument(skip(db, sqs))]
pub async fn run(db: PgPool, sqs: SQS, cancellation_token: tokio_util::sync::CancellationToken) {
    loop {
        if cancellation_token.is_cancelled() {
            return;
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

#[cfg(test)]
mod test;
