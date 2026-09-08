//! PostgreSQL native journal, fenced by the existing session management claim.
use crate::domain::event::CursorEvent;
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput};
use crate::domain::model::CursorRunId;
use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::model::{AgentSessionId, ManagerFence, ReplicaId};
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use sqlx::PgPool;
use std::sync::Mutex;

/// How long a streamed SSE record may sit buffered before it must be
/// durably flushed. A crash loses at most this much of the *tail* of a run's
/// streamed output — flushes are in sequence order, so a lost suffix never
/// punches a hole in the middle of the journal.
const JOURNAL_FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);
/// How many inputs may accumulate before a flush happens regardless of age.
const MAX_BUFFERED_JOURNAL_INPUTS: usize = 32;

/// One input the writer has accepted but not yet inserted.
#[derive(Debug, Clone)]
struct PendingJournalWrite {
    sequence: i64,
    run_id: Option<String>,
    input: serde_json::Value,
    inserted_at: DateTime<Utc>,
}

/// Streamed SSE content is the volume and can wait for the batch. Everything
/// else — prompts, polls, terminals, transport errors — must be durable
/// before ingest continues, because the rest of the system reacts to it.
fn journal_input_flushes(input: &JournalInput) -> bool {
    match input {
        JournalInput::Sse(record) => matches!(
            record.decode(),
            CursorEvent::Result { .. } | CursorEvent::Error { .. } | CursorEvent::Done
        ),
        _ => true,
    }
}

/// Bound to exactly one authorized host session and its current management
/// claim. A takeover updates the same locked row and invalidates this writer.
#[derive(Debug)]
pub struct PgCursorJournal {
    pool: PgPool,
    session: AgentSessionId,
    replica: ReplicaId,
    fence: std::sync::OnceLock<ManagerFence>,
    buffer: Mutex<Vec<PendingJournalWrite>>,
    flush_due: Mutex<Option<tokio::time::Instant>>,
}
impl PgCursorJournal {
    /// Construct an inactive journal. The attachment must activate it with
    /// its actual acquired claim before any read, append or provider action.
    pub fn new(pool: PgPool, session: AgentSessionId, replica: ReplicaId) -> Self {
        Self {
            pool,
            session,
            replica,
            fence: std::sync::OnceLock::new(),
            buffer: Mutex::new(Vec::new()),
            flush_due: Mutex::new(None),
        }
    }
    /// Bind once to the exact generation acquired for this attachment.
    /// Never infer or refresh authority from a database read.
    pub fn activate(
        &self,
        session: AgentSessionId,
        replica: ReplicaId,
        fence: ManagerFence,
    ) -> Result<(), rootcause::Report> {
        if session != self.session || replica != self.replica {
            return Err(rootcause::report!(
                "Cursor journal attachment identity mismatch"
            ));
        }
        if self.fence.set(fence).is_err() && self.fence.get() != Some(&fence) {
            return Err(rootcause::report!(
                "Cursor journal attachment cannot be rebound"
            ));
        }
        Ok(())
    }
    async fn lock_owner(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), rootcause::Report> {
        // Dispatch fencing cannot stop an already-running stream or mirror
        // poll. Hold the same row takeover updates until the journal commits;
        // checking the claim before opening this transaction would race.
        let expected = *self
            .fence
            .get()
            .ok_or_else(|| rootcause::report!("Cursor journal attachment is not activated"))?;
        let current = sqlx::query_scalar!("SELECT manager_fence FROM agent_session WHERE id = $1 AND manager_replica_id = $2 FOR UPDATE", self.session.as_uuid(), self.replica.as_uuid())
            .fetch_optional(&mut **tx).await.map_err(|e| rootcause::report!(e))?
            .ok_or_else(|| rootcause::report!("Cursor journal writer fenced out"))?;
        if ManagerFence(current) != expected {
            return Err(rootcause::report!("Cursor journal writer fenced out"));
        }
        Ok(())
    }

    async fn persist_batch(&self, batch: &[PendingJournalWrite]) -> Result<(), rootcause::Report> {
        if batch.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
        self.lock_owner(&mut tx).await?;
        let high = sqlx::query_scalar!("SELECT COALESCE(MAX(sequence), 0) AS \"high!\" FROM cursor_journal_input WHERE agent_session_id = $1", self.session.as_uuid())
            .fetch_one(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
        if high != batch[0].sequence - 1 {
            return Err(rootcause::report!(
                "Cursor journal sequence changed; reload required"
            ));
        }
        let sequences: Vec<i64> = batch.iter().map(|pending| pending.sequence).collect();
        let run_ids: Vec<Option<String>> =
            batch.iter().map(|pending| pending.run_id.clone()).collect();
        let inputs: Vec<serde_json::Value> =
            batch.iter().map(|pending| pending.input.clone()).collect();
        let inserted_ats: Vec<DateTime<Utc>> =
            batch.iter().map(|pending| pending.inserted_at).collect();
        sqlx::query!(
            r#"
            INSERT INTO cursor_journal_input(agent_session_id, sequence, run_id, input, inserted_at)
            SELECT $1, * FROM UNNEST($2::bigint[], $3::text[], $4::jsonb[], $5::timestamptz[])
            "#,
            self.session.as_uuid(),
            &sequences,
            &run_ids as &[Option<String>],
            &inputs,
            &inserted_ats,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| rootcause::report!(e))?;
        tx.commit().await.map_err(|e| rootcause::report!(e))?;
        Ok(())
    }
}
impl CursorJournal for PgCursorJournal {
    fn read<'a>(
        &'a self,
        _session: &'a SessionId,
    ) -> BoxFuture<'a, Result<Vec<JournalEntry>, rootcause::Report>> {
        Box::pin(async move {
            // A read is scoped by the bound host identity, never by a caller's
            // ACP ID, which is only unique within a transport.
            let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
            self.lock_owner(&mut tx).await?;
            let rows = sqlx::query!("SELECT sequence, run_id, input FROM cursor_journal_input WHERE agent_session_id = $1 ORDER BY sequence", self.session.as_uuid())
                .fetch_all(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
            tx.commit().await.map_err(|e| rootcause::report!(e))?;
            rows.into_iter()
                .map(|r| {
                    Ok(JournalEntry {
                        sequence: r.sequence,
                        run: r.run_id.map(CursorRunId::new),
                        input: serde_json::from_value(r.input)
                            .map_err(|e| rootcause::report!(e))?,
                    })
                })
                .collect()
        })
    }
    fn append<'a>(
        &'a self,
        _session: &'a SessionId,
        expected: i64,
        run: Option<&'a CursorRunId>,
        input: &'a JournalInput,
    ) -> BoxFuture<'a, Result<JournalEntry, rootcause::Report>> {
        Box::pin(async move {
            let payload = serde_json::to_value(input).map_err(|e| rootcause::report!(e))?;
            let sequence = expected + 1;
            let pending = PendingJournalWrite {
                sequence,
                run_id: run.map(|run| run.as_str().to_owned()),
                input: payload,
                inserted_at: Utc::now(),
            };
            let flush_now = {
                let mut buffer = self
                    .buffer
                    .lock()
                    .map_err(|_| rootcause::report!("Cursor journal buffer poisoned"))?;
                if let Some(last) = buffer.last()
                    && last.sequence != expected
                {
                    return Err(rootcause::report!(
                        "Cursor journal sequence changed; reload required"
                    ));
                }
                buffer.push(pending);
                if buffer.len() == 1 {
                    *self.flush_due.lock().map_err(|_| {
                        rootcause::report!("Cursor journal flush deadline poisoned")
                    })? = Some(tokio::time::Instant::now() + JOURNAL_FLUSH_INTERVAL);
                }
                journal_input_flushes(input) || buffer.len() >= MAX_BUFFERED_JOURNAL_INPUTS
            };
            if flush_now {
                self.flush().await?;
            }
            Ok(JournalEntry {
                sequence,
                run: run.cloned(),
                input: input.clone(),
            })
        })
    }

    fn flush(&self) -> BoxFuture<'_, Result<(), rootcause::Report>> {
        Box::pin(async move {
            let batch = {
                let mut buffer = self
                    .buffer
                    .lock()
                    .map_err(|_| rootcause::report!("Cursor journal buffer poisoned"))?;
                std::mem::take(&mut *buffer)
            };
            *self
                .flush_due
                .lock()
                .map_err(|_| rootcause::report!("Cursor journal flush deadline poisoned"))? = None;
            if batch.is_empty() {
                return Ok(());
            }
            // Taken before the write: retrying a batch whose commit may have
            // landed would duplicate sequences, so a failed flush loses its
            // inputs the same way a failed per-row write used to. Inputs that
            // arrive while this write is in flight stay in the buffer.
            self.persist_batch(&batch).await
        })
    }

    fn flush_deadline(&self) -> Option<tokio::time::Instant> {
        self.flush_due.lock().ok().and_then(|due| *due)
    }
}

#[cfg(test)]
mod test;
