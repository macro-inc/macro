//! Freeze one imported snapshot per registered thread before metadata completes it.

use crate::messages::insert::{BackfillMessageWriter, SkippedMessage};
use models_email::service::message::Message;
use sqlx::{PgPool, types::Uuid};

/// Durable state used to resume required effects without fetching/writing a new
/// provider snapshot after another delivery has already imported this thread.
pub struct ImportReceipt {
    pub thread_id: Option<Uuid>,
    pub completed: bool,
    pub provider_missing: bool,
}

/// A provider-deleted thread needs no content import. Stored snapshots still
/// require their attachment/metadata effects.
pub enum ImportOutcome {
    /// A canonical committed snapshot whose effects can now resume.
    Stored(ImportedThread),
    /// Confirmed provider deletion won before an import committed.
    ProviderMissing,
}

/// The winning import, or an existing receipt when a concurrent delivery won.
pub struct ImportedThread {
    pub thread_id: Uuid,
    pub skipped: Vec<SkippedMessage>,
    pub written: bool,
}

/// Missing registration is an error, never proof that work completed.
#[tracing::instrument(skip(pool), err)]
pub async fn receipt(
    pool: &PgPool,
    job_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<ImportReceipt> {
    Ok(sqlx::query_as!(ImportReceipt,
        r#"SELECT thread_id, completed_at IS NOT NULL AS "completed!", provider_missing
        FROM email_backfill_thread_progress WHERE backfill_job_id = $1 AND thread_provider_id = $2"#,
        job_id, provider_id
    ).fetch_one(pool).await?)
}

/// Commit missing messages and their canonical import receipt together. CRM
/// publication must succeed before this call. Existing messages are never
/// rewritten; this preserves label changes made before/during the provider read.
/// All DB locks are acquired after external work and released before effect fanout.
#[tracing::instrument(skip(pool, messages, is_unstorable), fields(message_count = messages.len() as i64), err)]
pub async fn write_thread(
    pool: &PgPool,
    job_id: Uuid,
    provider_id: &str,
    link_id: Uuid,
    messages: &mut [Message],
    is_unstorable: impl Fn(&anyhow::Error) -> bool,
) -> anyhow::Result<ImportOutcome> {
    let writer = BackfillMessageWriter {
        pool,
        link_id,
        is_unstorable,
    };
    let mut skipped = Vec::new();
    let mut recipients = writer.upsert_contacts(messages, &mut skipped).await?;
    let mut tx = pool.begin().await?;
    // Shared job lock allows different threads to import concurrently, while
    // cancellation/completion waits for their message transactions to finish.
    let active = sqlx::query_scalar!(
        "SELECT status = 'InProgress' AND link_id = $2 AND completed_threads IS NOT NULL FROM email_backfill_jobs WHERE id = $1 FOR SHARE",
        job_id, link_id
    ).fetch_one(&mut *tx).await?.unwrap_or(false);
    anyhow::ensure!(active, "backfill job is no longer active for this link");
    let imported = sqlx::query!(
        "SELECT thread_id, provider_missing FROM email_backfill_thread_progress WHERE backfill_job_id = $1 AND thread_provider_id = $2 FOR UPDATE",
        job_id, provider_id
    ).fetch_one(&mut *tx).await?;
    if imported.provider_missing {
        tx.commit().await?;
        return Ok(ImportOutcome::ProviderMissing);
    }
    if let Some(thread_id) = imported.thread_id {
        tx.commit().await?;
        return Ok(ImportOutcome::Stored(ImportedThread {
            thread_id,
            skipped: vec![],
            written: false,
        }));
    }
    let blank = crate::threads::insert::blank_thread(provider_id, link_id);
    let thread_id = crate::threads::insert::insert_thread(&mut tx, &blank, link_id).await?;
    let provider_ids: Vec<String> = messages
        .iter()
        .filter_map(|m| m.provider_id.clone())
        .collect();
    let existing = sqlx::query_scalar!(
        "SELECT provider_id FROM email_messages WHERE link_id = $1 AND provider_id = ANY($2)",
        link_id,
        &provider_ids
    )
    .fetch_all(&mut *tx)
    .await?;
    let existing: std::collections::HashSet<String> = existing.into_iter().flatten().collect();
    for (message, recipient) in messages.iter().zip(&mut recipients) {
        if message
            .provider_id
            .as_ref()
            .is_some_and(|id| existing.contains(id))
        {
            *recipient = None;
        }
    }
    writer
        .insert_messages(&mut tx, thread_id, messages, recipients, &mut skipped)
        .await?;
    sqlx::query!(
        "UPDATE email_backfill_thread_progress SET thread_id = $3 WHERE backfill_job_id = $1 AND thread_provider_id = $2",
        job_id, provider_id, thread_id
    ).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(ImportOutcome::Stored(ImportedThread {
        thread_id,
        skipped,
        written: true,
    }))
}

/// Record confirmed provider absence only if no import already won. A racing
/// successful import keeps its canonical receipt and must finish its effects.
#[tracing::instrument(skip(pool), err)]
pub async fn mark_provider_missing(
    pool: &PgPool,
    job_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<ImportReceipt> {
    let mut tx = pool.begin().await?;
    super::lock_job(&mut tx, job_id).await?;
    sqlx::query!(
        r#"UPDATE email_backfill_thread_progress SET provider_missing = true
        WHERE backfill_job_id = $1 AND thread_provider_id = $2 AND thread_id IS NULL
        AND EXISTS (SELECT 1 FROM email_backfill_jobs WHERE id = $1 AND status = 'InProgress')"#,
        job_id,
        provider_id
    )
    .execute(&mut *tx)
    .await?;
    let receipt = sqlx::query_as!(ImportReceipt,
        r#"SELECT thread_id, completed_at IS NOT NULL AS "completed!", provider_missing
        FROM email_backfill_thread_progress WHERE backfill_job_id = $1 AND thread_provider_id = $2"#,
        job_id, provider_id
    ).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(receipt)
}
