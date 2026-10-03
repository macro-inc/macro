//! Rebuild the list activity projection from authoritative ACP history.

use std::num::NonZeroUsize;

use agent_fold::domain::lifecycle::LifecycleFold;
use agent_fold::domain::model::TurnState;
use macro_uuid::Uuid;

use super::error::Result;
use super::model::AgentSessionId;
use super::ports::AgentSessionLogRepo;

/// The persistence operations needed by a bounded projection backfill.
pub trait SessionTurnProjectionRepo {
    /// At most `limit` sessions that have never had their activity projected.
    fn unprojected_sessions(
        &self,
        limit: NonZeroUsize,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;

    /// Initialize a missing projection only if `last_log_id` still ends the
    /// session's log. Atomically checks the cursor and absence of a projection
    /// under the same session lock as live appends. Returns false on a race.
    fn initialize_turn_state(
        &self,
        session: AgentSessionId,
        last_log_id: Option<Uuid>,
        turn_state: TurnState,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Counts from one bounded pass. Run another pass if `examined` reached the limit.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct TurnStateBackfill {
    /// Sessions whose effective history was examined.
    pub examined: usize,
    /// Missing projections initialized successfully.
    pub projected: usize,
}

/// Project one bounded batch of existing sessions without changing their log,
/// timestamps, or lifecycle. Live writers always win a concurrent transition.
pub async fn backfill_turn_states<R>(repo: &R, limit: NonZeroUsize) -> Result<TurnStateBackfill>
where
    R: SessionTurnProjectionRepo + AgentSessionLogRepo,
{
    let sessions = repo.unprojected_sessions(limit).await?;
    let mut result = TurnStateBackfill {
        examined: sessions.len(),
        projected: 0,
    };
    for session in sessions {
        let entries = repo.list_by_session(session).await?;
        let last_log_id = entries.last().map(|entry| entry.id);
        let mut fold = LifecycleFold::new();
        for entry in entries {
            let _ = fold.push(entry.entry);
        }
        if repo
            .initialize_turn_state(session, last_log_id, fold.inner().metadata().turn)
            .await?
        {
            result.projected += 1;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod test;
