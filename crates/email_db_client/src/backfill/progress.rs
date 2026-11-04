//! Durable, identity-based backfill progress. Every mutation locks the job
//! before its pages/threads, so listing and completion share one ordering.

pub mod import;

use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, Transaction};

/// A saved provider page, replayed verbatim after an interrupted publication.
#[derive(Debug, PartialEq, Eq)]
pub struct ListingPage {
    pub thread_provider_ids: Vec<String>,
    pub next_page_token: Option<String>,
}

/// Current durable progress; a provider estimate is never completion evidence.
#[derive(Debug, PartialEq, Eq)]
pub struct JobThreadProgress {
    pub completed_threads: i32,
    pub total_threads: i32,
    pub listing_complete: bool,
    pub active: bool,
}

/// Whether this job was initialized with durable progress.
#[tracing::instrument(skip(pool), err)]
pub async fn is_tracked(pool: &PgPool, job_id: Uuid) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT completed_threads IS NOT NULL FROM email_backfill_jobs WHERE id = $1",
        job_id
    )
    .fetch_optional(pool)
    .await?
    .flatten()
    .unwrap_or(false))
}

async fn lock_job(tx: &mut Transaction<'_, Postgres>, job_id: Uuid) -> anyhow::Result<()> {
    let tracked = sqlx::query_scalar!(
        "SELECT completed_threads IS NOT NULL FROM email_backfill_jobs WHERE id = $1 FOR UPDATE",
        job_id
    )
    .fetch_optional(&mut **tx)
    .await?
    .flatten()
    .unwrap_or(false);
    anyhow::ensure!(
        tracked,
        "backfill progress requires explicit legacy recovery"
    );
    Ok(())
}

/// Read a saved page before requesting Gmail again.
#[tracing::instrument(skip(pool, page_token), err)]
pub async fn get_page(
    pool: &PgPool,
    job_id: Uuid,
    priority: bool,
    page_token: &str,
) -> anyhow::Result<Option<ListingPage>> {
    Ok(sqlx::query_as!(ListingPage,
        "SELECT thread_provider_ids, next_page_token FROM email_backfill_listing_pages WHERE backfill_job_id = $1 AND priority_pass = $2 AND page_token = $3",
        job_id, priority, page_token
    ).fetch_optional(pool).await?)
}

/// Save the first answer for a page and register its unique thread identities
/// atomically. Concurrent/repeated listings return the winning saved answer.
#[tracing::instrument(skip(pool, page_token, page), err)]
pub async fn register_page(
    pool: &PgPool,
    job_id: Uuid,
    priority: bool,
    page_token: &str,
    page: ListingPage,
) -> anyhow::Result<ListingPage> {
    let mut tx = pool.begin().await?;
    lock_job(&mut tx, job_id).await?;
    let inserted = sqlx::query!(
        r#"INSERT INTO email_backfill_listing_pages
            (backfill_job_id, priority_pass, page_token, thread_provider_ids, next_page_token)
        SELECT id, $2, $3, $4, $5 FROM email_backfill_jobs
        WHERE id = $1 AND status = 'InProgress' AND NOT listing_complete
        ON CONFLICT DO NOTHING"#,
        job_id,
        priority,
        page_token,
        &page.thread_provider_ids,
        page.next_page_token
    )
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if inserted {
        let added = sqlx::query!(
            r#"INSERT INTO email_backfill_thread_progress (backfill_job_id, thread_provider_id)
            SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING"#,
            job_id,
            &page.thread_provider_ids
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        let added = i32::try_from(added)?;
        let retrieved = if priority {
            0
        } else {
            i32::try_from(page.thread_provider_ids.len())?
        };
        sqlx::query!(
            "UPDATE email_backfill_jobs SET listed_threads = listed_threads + $2, threads_retrieved_count = threads_retrieved_count + $3, updated_at = now() WHERE id = $1",
            job_id, added, retrieved
        ).execute(&mut *tx).await?;
    }
    let saved = sqlx::query_as!(ListingPage,
        "SELECT thread_provider_ids, next_page_token FROM email_backfill_listing_pages WHERE backfill_job_id = $1 AND priority_pass = $2 AND page_token = $3",
        job_id, priority, page_token
    ).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(saved)
}

/// Mark the normal listing exhausted, after publishing its final page.
#[tracing::instrument(skip(pool), err)]
pub async fn finish_listing(pool: &PgPool, job_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_backfill_jobs SET listing_complete = true,
            total_threads = listed_threads, updated_at = now()
        WHERE id = $1 AND completed_threads IS NOT NULL AND status = 'InProgress'"#,
        job_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Check a thread's retained completion evidence. An unknown identity is an
/// error, never a successful skip or an implicit registration.
#[tracing::instrument(skip(pool), err)]
pub async fn thread_completed(pool: &PgPool, job_id: Uuid, thread: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT completed_at IS NOT NULL FROM email_backfill_thread_progress WHERE backfill_job_id = $1 AND thread_provider_id = $2",
        job_id, thread
    ).fetch_one(pool).await?.unwrap_or(false))
}

/// Record completion once, after all required thread effects succeeded.
/// Repeated completion still returns current progress so interrupted job
/// completion/outbox creation can be retried.
#[tracing::instrument(skip(pool), err)]
pub async fn complete_thread(
    pool: &PgPool,
    job_id: Uuid,
    thread: &str,
) -> anyhow::Result<JobThreadProgress> {
    let mut tx = pool.begin().await?;
    lock_job(&mut tx, job_id).await?;
    let added = sqlx::query!(
        r#"UPDATE email_backfill_thread_progress SET completed_at = now()
        WHERE backfill_job_id = $1 AND thread_provider_id = $2 AND completed_at IS NULL AND (thread_id IS NOT NULL OR provider_missing)
          AND EXISTS (SELECT 1 FROM email_backfill_jobs WHERE id = $1 AND status = 'InProgress')"#,
        job_id,
        thread
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    // Require the identity even on replay; don't silently acknowledge unknown work.
    sqlx::query_scalar!(
        "SELECT thread_provider_id FROM email_backfill_thread_progress WHERE backfill_job_id = $1 AND thread_provider_id = $2 AND (thread_id IS NOT NULL OR provider_missing)",
        job_id, thread
    ).fetch_one(&mut *tx).await?;
    let added = i32::try_from(added)?;
    let progress = sqlx::query_as!(JobThreadProgress,
        r#"UPDATE email_backfill_jobs SET completed_threads = completed_threads + $2, updated_at = now()
        WHERE id = $1 RETURNING completed_threads AS "completed_threads!",
            listed_threads AS total_threads, listing_complete, status = 'InProgress' AS "active!""#,
        job_id, added
    ).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(progress)
}

#[cfg(test)]
mod test;
