//! Reading the branch a Cursor agent pushed back out of the journal.

use crate::domain::event::{GitBranch, GitState};
use crate::domain::journal::JournalInput;
use crate::domain::ports::PushedBranches;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// How many of a session's newest journal rows are read looking for a
/// terminal result. A run journals hundreds of records; its `result` is
/// among the last few, and a session rarely has more than a handful of runs.
const NEWEST_ROWS: i64 = 500;

/// [`PushedBranches`] over `cursor_journal_input`, the same rows the
/// fenced journal writes. Read-only and unfenced: it never competes with the
/// live writer, and a branch reported by any earlier run is as true as ever.
#[derive(Clone)]
pub struct PgPushedBranches {
    pool: PgPool,
}

impl PgPushedBranches {
    /// Read through `pool`.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl PushedBranches for PgPushedBranches {
    #[tracing::instrument(skip(self), err, fields(agent.session.id = %agent_session_id))]
    async fn latest_pushed_branch(
        &self,
        agent_session_id: uuid::Uuid,
    ) -> Result<Option<GitBranch>, rootcause::Report> {
        // Only the record kinds that can carry a terminal result: streamed
        // SSE records and polling bodies. Newest first, so the first hit is
        // the latest run's word.
        let rows = sqlx::query_scalar!(
            r#"
            SELECT input
            FROM cursor_journal_input
            WHERE agent_session_id = $1 AND (input ? 'Sse' OR input ? 'Poll')
            ORDER BY sequence DESC
            LIMIT $2
            "#,
            agent_session_id,
            NEWEST_ROWS,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        Ok(rows.into_iter().find_map(|row| pushed_branch(&row)))
    }
}

/// The pushed branch a journaled input reports, if it is a terminal result
/// that reports one.
fn pushed_branch(input: &serde_json::Value) -> Option<GitBranch> {
    let input: JournalInput = serde_json::from_value(input.clone()).ok()?;
    let payload: serde_json::Value = match &input {
        JournalInput::Sse(record) if record.event == "result" => {
            serde_json::from_str(&record.data).ok()?
        }
        JournalInput::Poll(raw) => serde_json::from_str(raw).ok()?,
        _ => return None,
    };
    let git: GitState = serde_json::from_value(payload.get("git")?.clone()).ok()?;
    git.branches.into_iter().find(|branch| {
        branch
            .branch
            .as_deref()
            .is_some_and(|name| !name.is_empty())
    })
}
