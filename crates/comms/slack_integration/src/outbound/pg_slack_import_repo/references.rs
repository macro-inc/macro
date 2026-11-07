//! Job-scoped bounded templates and transaction-held reconciliation fences.
//! Locking the job (not a conversation lease) permits cancellation recovery without
//! reclaiming imports. A crashed transaction releases the fence and rolls back all
//! work. SKIP LOCKED allows independent maintenance processes to make progress.

use sqlx::{Postgres, Transaction};

use crate::domain::{
    reference_reconciliation::IMPORTER_BODY_VERSION, slack::references::ConvertedText,
};

use super::*;

#[cfg(test)]
mod test;

/// Persist only a newly won canonical source mapping, in its historical transaction.
/// Duplicate-import losers must never create intents for the winner's live body.
pub async fn insert_in(
    tx: &mut Transaction<'_, Postgres>,
    lease: &Lease,
    message: &HistoricalMessage,
) -> PortResult<()> {
    if message.body_references.is_empty() {
        return Ok(());
    }
    let team = lifecycle::fence(tx, lease).await?;
    if message.source.team_id != team
        || message.source.slack_channel_id != lease.event.slack_channel_id
    {
        return Err(ImportError::InvalidInput.into());
    }
    let template = ConvertedText {
        body: message.content.clone(),
        user_mentions: message.user_mentions.clone(),
        references: message.body_references.clone(),
    };
    template
        .render(&[])
        .map_err(|_| ImportError::InvalidInput)?;
    let template = serde_json::to_value(template).map_err(internal)?;
    if serde_json::to_vec(&template).map_err(internal)?.len() > 4 * 1024 * 1024 {
        return Err(ImportError::LimitExceeded.into());
    }
    sqlx::query!(
        r#"INSERT INTO slack_import_message_reference
           (job_id, slack_channel_id, message_id, channel_id, importer_version, template)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (job_id, message_id) DO NOTHING"#,
        Uuid::from(lease.event.job_id),
        lease.event.slack_channel_id.as_str(),
        message.id,
        message.channel_id,
        IMPORTER_BODY_VERSION,
        template,
    )
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(())
}

/// Durable immutable input. Message existence/body ownership is checked by its owner.
pub struct ReferenceWork {
    /// Job's team namespace.
    pub team: TeamId,
    /// Owning job.
    pub job: JobId,
    /// Source conversation owning search work.
    pub conversation: ConversationId,
    /// Final mapped message, never a discarded candidate UUID.
    pub message: Uuid,
    /// Expected owning channel.
    pub channel: Uuid,
    /// Importer schema/body guard.
    pub version: i16,
    /// None for corrupt/unsupported evidence: close without touching the body.
    pub template: Option<ConvertedText>,
}

/// Unforgeable transaction-scoped fence. No lease can expire mid-patch: the job
/// lock is held through completion and commit, and no work escapes this transaction.
pub struct FencedReference<'a, 'c> {
    tx: &'a mut Transaction<'c, Postgres>,
    work: ReferenceWork,
}

/// Select one template (at most 4 MiB) after all selected conversations settle.
/// Registration must close too: uploads can otherwise still create future targets.
pub async fn next_in<'a, 'c>(
    tx: &'a mut Transaction<'c, Postgres>,
) -> PortResult<Option<FencedReference<'a, 'c>>> {
    let job = sqlx::query!(
        r#"SELECT j.id, j.team_id FROM slack_import_job j
           WHERE j.registration_closed_at IS NOT NULL
             AND j.status IN ('uploading', 'processing', 'cancelling')
             AND NOT EXISTS (SELECT 1 FROM slack_import_conversation c WHERE c.job_id = j.id
                 AND c.status IN ('awaiting_uploads', 'queued', 'importing'))
             AND EXISTS (SELECT 1 FROM slack_import_message_reference r
                 WHERE r.job_id = j.id AND r.completed_at IS NULL)
           ORDER BY j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED"#,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?;
    let Some(job) = job else {
        return Ok(None);
    };
    let row = sqlx::query!(
        r#"SELECT slack_channel_id, message_id, channel_id, importer_version, template
           FROM slack_import_message_reference WHERE job_id = $1 AND completed_at IS NULL
           ORDER BY message_id LIMIT 1"#,
        job.id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?;
    // Another transaction may have finished the last intent between the candidate
    // snapshot and our acquiring its job lock.
    let Some(row) = row else {
        return Ok(None);
    };
    let work = ReferenceWork {
        team: job.team_id.try_into().map_err(internal)?,
        job: job.id.try_into().map_err(internal)?,
        conversation: row.slack_channel_id.parse().map_err(internal)?,
        message: row.message_id,
        channel: row.channel_id,
        version: row.importer_version,
        template: row
            .template
            .and_then(|value| serde_json::from_value(value).ok()),
    };
    Ok(Some(FencedReference { tx, work }))
}

impl<'c> FencedReference<'_, 'c> {
    /// Immutable durable evidence loaded under the fence.
    pub fn work(&self) -> &ReferenceWork {
        &self.work
    }

    /// Borrow the same transaction for the message owner's guarded body update.
    pub fn transaction(&mut self) -> &mut Transaction<'c, Postgres> {
        self.tx
    }

    /// Close the intent permanently and atomically dirty search if a body changed.
    /// Clear bulky source evidence; retain a small completion checkpoint until cleanup.
    pub async fn finish(self, changed: bool) -> PortResult<()> {
        let job = Uuid::from(self.work.job);
        sqlx::query!(
            r#"UPDATE slack_import_message_reference SET template = NULL, completed_at = clock_timestamp()
               WHERE job_id = $1 AND message_id = $2 AND completed_at IS NULL"#,
            job, self.work.message,
        ).execute(&mut **self.tx).await.map_err(internal)?;
        if changed {
            let generation = sqlx::query_scalar!(
                r#"UPDATE slack_import_conversation SET search_dirty_generation = search_dirty_generation + 1,
                   search_state = 'pending', search_receipt_id = NULL, search_submitted_generation = NULL,
                   search_updated_at = clock_timestamp(), updated_at = clock_timestamp()
                   WHERE job_id = $1 AND slack_channel_id = $2 RETURNING search_dirty_generation"#,
                job, self.work.conversation.as_str(),
            ).fetch_one(&mut **self.tx).await.map_err(internal)?;
            sqlx::query!(
                r#"UPDATE slack_import_outbox SET cancelled_at = clock_timestamp()
                   WHERE job_id = $1 AND slack_channel_id = $2 AND kind = 'search'
                     AND published_at IS NULL AND cancelled_at IS NULL"#,
                job,
                self.work.conversation.as_str(),
            )
            .execute(&mut **self.tx)
            .await
            .map_err(internal)?;
            sqlx::query!(
                r#"INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation)
                   VALUES ($1, $2, 'search', $3) ON CONFLICT DO NOTHING"#,
                job,
                self.work.conversation.as_str(),
                generation,
            )
            .execute(&mut **self.tx)
            .await
            .map_err(internal)?;
        }
        lifecycle::recompute(self.tx, self.work.job).await
    }
}
