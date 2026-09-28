//! Durable cloud conversations bound to the host session's management claim.

use crate::domain::acp_session::{SessionStore, StoredSession};
use crate::domain::cloud::TurnId;
use crate::domain::journal::{JournalEntry, JournalInput};
use agent_session::domain::model::{AgentSessionId, ManagerFence, ReplicaId};
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};

/// Journal for one Macro session and one activated runtime attachment.
pub struct PgCodexJournal {
    pool: PgPool,
    session: AgentSessionId,
    replica: ReplicaId,
    fence: OnceLock<ManagerFence>,
}

impl PgCodexJournal {
    /// Create an inactive journal; activate it only after acquiring management.
    pub fn new(pool: PgPool, session: AgentSessionId, replica: ReplicaId) -> Self {
        Self {
            pool,
            session,
            replica,
            fence: OnceLock::new(),
        }
    }

    /// Bind this attachment permanently to its acquired management generation.
    pub fn activate(
        &self,
        session: AgentSessionId,
        replica: ReplicaId,
        fence: ManagerFence,
    ) -> Result<(), rootcause::Report> {
        if session != self.session || replica != self.replica {
            return Err(rootcause::report!(
                "Codex journal attachment identity mismatch"
            ));
        }
        if self.fence.set(fence).is_err() && self.fence.get() != Some(&fence) {
            return Err(rootcause::report!(
                "Codex journal attachment cannot be rebound"
            ));
        }
        Ok(())
    }

    fn check_id(&self, id: &str) -> Result<(), rootcause::Report> {
        if id != self.session.to_string() {
            return Err(rootcause::report!(
                "Codex journal session identity mismatch"
            ));
        }
        Ok(())
    }

    async fn lock_owner(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), rootcause::Report> {
        let expected = self
            .fence
            .get()
            .ok_or_else(|| rootcause::report!("Codex journal attachment is not activated"))?;
        // Hold the same row used for takeover until this checkpoint commits.
        // Ordinary log writers also lock it, so contention is not lost ownership.
        let current = sqlx::query_scalar!("SELECT manager_fence FROM agent_session WHERE id = $1 AND manager_replica_id = $2 FOR UPDATE", self.session.as_uuid(), self.replica.as_uuid())
            .fetch_optional(&mut **tx).await.map_err(|e| rootcause::report!(e))?
            .ok_or_else(|| rootcause::report!("Codex journal writer fenced out"))?;
        if ManagerFence(current) != *expected {
            return Err(rootcause::report!("Codex journal writer fenced out"));
        }
        Ok(())
    }
}

impl SessionStore for Arc<PgCodexJournal> {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        self.check_id(id)?;
        let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
        self.lock_owner(&mut tx).await?;
        let state = sqlx::query_scalar!("SELECT state FROM codex_cloud_sessions WHERE agent_session_id = $1 AND acp_session_id = $2", self.session.as_uuid(), id)
            .fetch_optional(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
        tx.commit().await.map_err(|e| rootcause::report!(e))?;
        state
            .map(|value| {
                serde_json::from_value(value)
                    .map_err(|_| rootcause::report!("Invalid Codex session journal"))
            })
            .transpose()
    }

    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        self.check_id(id)?;
        let payload = serde_json::to_value(state)
            .map_err(|_| rootcause::report!("Could not encode Codex session journal"))?;
        let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
        self.lock_owner(&mut tx).await?;
        sqlx::query!("INSERT INTO codex_cloud_sessions (agent_session_id, acp_session_id, state) VALUES ($1, $2, $3) ON CONFLICT (agent_session_id) DO UPDATE SET state = EXCLUDED.state", self.session.as_uuid(), id, payload)
            .execute(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
        tx.commit().await.map_err(|e| rootcause::report!(e))?;
        Ok(())
    }

    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>, rootcause::Report> {
        self.check_id(id)?;
        let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
        self.lock_owner(&mut tx).await?;
        let rows = sqlx::query!(
            "SELECT sequence, turn_id, input FROM codex_journal_input WHERE agent_session_id = $1 ORDER BY sequence",
            self.session.as_uuid()
        ).fetch_all(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
        tx.commit().await.map_err(|e| rootcause::report!(e))?;
        let mut entries = Vec::with_capacity(rows.len());
        for (index, row) in rows.into_iter().enumerate() {
            if row.sequence
                != i64::try_from(index)
                    .ok()
                    .and_then(|index| index.checked_add(1))
                    .ok_or_else(|| rootcause::report!("Codex journal sequence overflow"))?
            {
                return Err(rootcause::report!(
                    "Codex journal history has a sequence gap; complete replay unavailable"
                ));
            }
            entries.push(JournalEntry {
                sequence: row.sequence,
                turn: row.turn_id.map(TurnId::new).transpose()?,
                input: serde_json::from_value(row.input).map_err(|_| {
                    rootcause::report!(
                        "Invalid Codex native journal input; complete replay unavailable"
                    )
                })?,
            });
        }
        Ok(entries)
    }

    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry, rootcause::Report> {
        self.check_id(id)?;
        let sequence = expected
            .checked_add(1)
            .filter(|sequence| *sequence > 0)
            .ok_or_else(|| rootcause::report!("invalid Codex journal expected sequence"))?;
        let payload = serde_json::to_value(input)
            .map_err(|_| rootcause::report!("Could not encode Codex native journal input"))?;
        let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
        self.lock_owner(&mut tx).await?;
        let high = sqlx::query_scalar!(
            "SELECT COALESCE(MAX(sequence), 0) AS \"high!\" FROM codex_journal_input WHERE agent_session_id = $1",
            self.session.as_uuid()
        ).fetch_one(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
        if high != expected {
            return Err(rootcause::report!(
                "Codex journal sequence changed; reload required"
            ));
        }
        let turn_id = turn.map(TurnId::as_str);
        sqlx::query!(
            "INSERT INTO codex_journal_input (agent_session_id, sequence, turn_id, input) VALUES ($1, $2, $3, $4)",
            self.session.as_uuid(), sequence, turn_id, payload
        ).execute(&mut *tx).await.map_err(|e| rootcause::report!(e))?;
        tx.commit().await.map_err(|e| rootcause::report!(e))?;
        Ok(JournalEntry {
            sequence,
            turn: turn.cloned(),
            input: input.clone(),
        })
    }

    async fn validate(&self) -> Result<(), rootcause::Report> {
        let mut tx = self.pool.begin().await.map_err(|e| rootcause::report!(e))?;
        self.lock_owner(&mut tx).await?;
        tx.commit().await.map_err(|e| rootcause::report!(e))?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
