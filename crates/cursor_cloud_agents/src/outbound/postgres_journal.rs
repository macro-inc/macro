//! PostgreSQL native journal, written under the session's lock.
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput};
use crate::domain::model::CursorRunId;
use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::model::{AgentSessionId, SessionLock};
use futures::future::BoxFuture;
use sqlx::PgPool;
use tracing::Instrument;

/// Bound to exactly one host session and the lock its attach took. A
/// takeover bumps the same locked row's token and invalidates this writer.
#[derive(Debug)]
pub struct PgCursorJournal {
    pool: PgPool,
    session: AgentSessionId,
    lock: std::sync::OnceLock<SessionLock>,
}
impl PgCursorJournal {
    /// Construct an inactive journal. The attachment must activate it with
    /// the lock it actually acquired before any read, append or provider action.
    pub fn new(pool: PgPool, session: AgentSessionId) -> Self {
        Self {
            pool,
            session,
            lock: std::sync::OnceLock::new(),
        }
    }
    /// Bind once to the exact lock acquired for this attachment. Never infer
    /// or refresh authority from a database read.
    pub fn activate(&self, lock: SessionLock) -> Result<(), rootcause::Report> {
        if lock.session() != self.session {
            return Err(rootcause::report!(
                "Cursor journal attachment identity mismatch"
            ));
        }
        if self.lock.set(lock).is_err() && self.lock.get() != Some(&lock) {
            return Err(rootcause::report!(
                "Cursor journal attachment cannot be rebound"
            ));
        }
        Ok(())
    }
    async fn hold_lock(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), rootcause::Report> {
        // Dispatch checks cannot stop an already-running stream or mirror
        // poll. Hold the same row a takeover updates until the journal
        // commits; checking before opening this transaction would race.
        let lock = self
            .lock
            .get()
            .ok_or_else(|| rootcause::report!("Cursor journal attachment is not activated"))?;
        sqlx::query_scalar!(
            "SELECT 1 AS \"one!\" FROM agent_session WHERE id = $1 AND manager_fence = $2 FOR UPDATE",
            self.session.as_uuid(),
            lock.token(),
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| rootcause::report!(e))?
        .ok_or_else(|| rootcause::report!("Cursor journal writer lost the session lock"))?;
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
            self.hold_lock(&mut tx).await?;
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
            self.hold_lock(&mut tx).await?;
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
