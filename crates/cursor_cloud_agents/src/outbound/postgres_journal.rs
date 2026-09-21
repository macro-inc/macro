//! PostgreSQL native journal, fenced by the existing session management claim.
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput};
use crate::domain::model::CursorRunId;
use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::model::{AgentSessionId, ManagerFence, ReplicaId};
use futures::future::BoxFuture;
use sqlx::PgPool;
use tracing::Instrument;

/// Bound to exactly one authorized host session and its current management
/// claim. A takeover updates the same locked row and invalidates this writer.
#[derive(Debug)]
pub struct PgCursorJournal {
    pool: PgPool,
    session: AgentSessionId,
    replica: ReplicaId,
    fence: std::sync::OnceLock<ManagerFence>,
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
    /// Its own span because its duration is the row-lock wait: the one
    /// number that tells a contended row apart from a slow database or a
    /// slow Cursor API when a journal write looks stuck.
    #[tracing::instrument(name = "cursor.journal.lock_owner", skip_all)]
    async fn lock_owner(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), rootcause::Report> {
        // Dispatch fencing cannot stop an already-running stream or mirror
        // poll. Hold the same row takeover updates until the journal commits;
        // checking the claim before opening this transaction would race.
        //
        // A plain, blocking FOR UPDATE - never NOWAIT. This row is shared
        // with writers that are not takeovers at all: the session actor's
        // fenced log write locks it for every frame it stores, and during a
        // streaming turn that write runs concurrently with the very append
        // that produced the frame. Contention here is therefore routine and
        // says nothing about the claim; only the fence comparison below does.
        // Treating "someone else holds the row" as "fenced out" failed every
        // streaming turn the moment its first text delta was logged. A
        // superseding claim is still detected promptly: its single-statement
        // transaction commits in milliseconds, after which this select
        // re-reads the row and the fence no longer matches.
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
}
impl CursorJournal for PgCursorJournal {
    fn read<'a>(
        &'a self,
        _session: &'a SessionId,
    ) -> BoxFuture<'a, Result<Vec<JournalEntry>, rootcause::Report>> {
        let span = tracing::info_span!(
            "cursor.journal.read",
            agent.session.id = %self.session,
        );
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
        }.instrument(span))
    }
    fn append<'a>(
        &'a self,
        _session: &'a SessionId,
        expected: i64,
        run: Option<&'a CursorRunId>,
        input: &'a JournalInput,
    ) -> BoxFuture<'a, Result<JournalEntry, rootcause::Report>> {
        let span = tracing::info_span!(
            "cursor.journal.append",
            agent.session.id = %self.session,
            cursor.run.id = run.map(tracing::field::display),
            cursor.journal.expected_sequence = expected,
        );
        Box::pin(async move {
            let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
            self.lock_owner(&mut tx).await?;
            let high = sqlx::query_scalar!("SELECT COALESCE(MAX(sequence), 0) AS \"high!\" FROM cursor_journal_input WHERE agent_session_id = $1", self.session.as_uuid())
                .fetch_one(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
            if high != expected {
                return Err(rootcause::report!(
                    "Cursor journal sequence changed; reload required"
                ));
            }
            let payload = serde_json::to_value(input).map_err(|e| rootcause::report!(e))?;
            let sequence = expected + 1;
            let run_id = run.map(CursorRunId::as_str);
            sqlx::query!("INSERT INTO cursor_journal_input(agent_session_id, sequence, run_id, input) VALUES ($1, $2, $3, $4)", self.session.as_uuid(), sequence, run_id, payload)
                .execute(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
            tx.commit().await.map_err(|e| rootcause::report!(e))?;
            Ok(JournalEntry {
                sequence,
                run: run.cloned(),
                input: input.clone(),
            })
        }.instrument(span))
    }
}

#[cfg(test)]
mod test;
