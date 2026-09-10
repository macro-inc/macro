//! PostgreSQL native journal, fenced by the existing session management claim.
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput};
use crate::domain::model::CursorRunId;
use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::model::{AgentSessionId, ManagerFence, ReplicaId};
use futures::future::BoxFuture;
use sqlx::PgPool;

/// Postgres' `lock_not_available` SQLSTATE, the error `FOR UPDATE NOWAIT`
/// raises instead of blocking. <https://www.postgresql.org/docs/current/errcodes-appendix.html>
const LOCK_NOT_AVAILABLE: &str = "55P03";

/// Whether `error` is exactly the row already being locked by another
/// transaction - the one outcome `NOWAIT` exists to turn into an immediate
/// error rather than a wait.
fn is_lock_not_available(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(db_err) if db_err.code().as_deref() == Some(LOCK_NOT_AVAILABLE)
    )
}

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
    async fn lock_owner(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), rootcause::Report> {
        // Dispatch fencing cannot stop an already-running stream or mirror
        // poll. Hold the same row takeover updates until the journal commits;
        // checking the claim before opening this transaction would race.
        //
        // NOWAIT, not a plain FOR UPDATE: a writer whose claim is being
        // superseded (a resume/reattach bumping this same row's fence) has no
        // business waiting for that other transaction to commit - it has
        // already lost, whatever the wait would answer. Blocking here used to
        // leave a stale writer's read/append hanging until some caller far
        // above gave up on an unrelated wall-clock timeout (tens of seconds)
        // and force-tore the session down from outside; failing the lock
        // immediately turns that into a fencing error on the spot, which is
        // the caller's cue to reattach right away instead of stalling first.
        let expected = *self
            .fence
            .get()
            .ok_or_else(|| rootcause::report!("Cursor journal attachment is not activated"))?;
        let current = sqlx::query_scalar!("SELECT manager_fence FROM agent_session WHERE id = $1 AND manager_replica_id = $2 FOR UPDATE NOWAIT", self.session.as_uuid(), self.replica.as_uuid())
            .fetch_optional(&mut **tx).await.map_err(|e| {
                if is_lock_not_available(&e) {
                    // Someone else - almost always a superseding claim - holds
                    // this row right now. We would lose that race even if we
                    // waited, so report it exactly like a lost fence.
                    rootcause::report!("Cursor journal writer fenced out")
                } else {
                    // Every other database failure keeps its type, SQLSTATE
                    // and source chain, as elsewhere in this file.
                    rootcause::report!(e).into_dynamic()
                }
            })?
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
        })
    }
}

#[cfg(test)]
mod test;
