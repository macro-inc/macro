//! Close out turns that nothing is driving any more.
//!
//! A session's log is the only thing its transcript reads, and a turn ends in
//! that log because something wrote the ending: the runtime reported a stop
//! reason, or the actor winding down wrote [`SystemEvent::Disconnected`] on
//! its way out. Both need the replica holding the session to still be there.
//!
//! When that replica dies mid-turn - killed, evicted, OOM - neither happens.
//! The last frames it had batched in memory are gone, the log simply stops,
//! and the projection stays open. A reader cannot tell that from an agent
//! that is thinking hard, so the transcript shimmers "Thinking" over a
//! half-written thought for as long as anyone keeps the session open.
//!
//! The lease already knows better: a session whose manager's heartbeat went
//! stale has nobody driving it. This sweep turns that into the frame the log
//! is missing, so a turn that stopped reads as stopped.

#[cfg(test)]
mod test;

use std::num::NonZeroUsize;
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};

use super::error::Result;
use super::model::{AgentSessionId, AgentSessionLog, ClaimOutcome, Message, ReplicaId};
use super::ports::{
    AgentSessionLogRepo, AgentSessionLogWriter, AgentSessionRealtime, AgentSessionRepo,
    SessionOwnership,
};
use super::service::LiveSessionLogWriter;

/// How quiet an unmanaged session must be before its open turn is closed.
///
/// Comfortably longer than
/// [`REPLICA_STALE_AFTER`](super::ports::REPLICA_STALE_AFTER): a replica that
/// is merely slow to beat, or one working through a graceful teardown, gets
/// to write its own ending rather than have one written for it.
pub const ABANDONED_TURN_QUIET_FOR: Duration = Duration::from_secs(120);

/// How often a replica looks for turns nothing is driving.
pub const ABANDONED_TURN_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// How many abandoned turns one pass closes. Each costs a claim, a fold of
/// the session's log, and an append, so a pass stays small and the next tick
/// picks up the rest.
pub const ABANDONED_TURN_SWEEP_LIMIT: NonZeroUsize = NonZeroUsize::new(20).unwrap();

/// The persistence a sweep needs beyond the lease and the log.
pub trait AbandonedTurnRepo: Send + Sync + 'static {
    /// At most `limit` sessions whose projected turn is still open, whose
    /// last log frame is older than `quiet_for`, and whose management lease
    /// no live replica holds.
    fn abandoned_turns(
        &self,
        quiet_for: Duration,
        limit: NonZeroUsize,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;
}

/// Counts from one bounded pass. Run another if `examined` reached the limit.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct AbandonedTurnSweep {
    /// Sessions that looked abandoned when the pass started.
    pub examined: usize,
    /// Sessions whose turn this pass closed.
    pub closed: usize,
}

/// Close one bounded batch of turns no live replica is driving.
///
/// Safe to run from every replica at once, and safe to run against a session
/// that was resumed a moment ago: each close takes the session's lease first,
/// and the lease is only takeable from a stale holder.
///
/// One session's failure does not end the pass. A close that loses its race
/// or cannot write is left for the next tick, which is also what happens to
/// everything past `limit`.
#[tracing::instrument(
    name = "agent.session.close_abandoned_turns",
    err,
    skip(repo, realtime),
    fields(
        agent.replica.id = %replica,
        agent.sessions.examined = tracing::field::Empty,
        agent.sessions.closed = tracing::field::Empty,
    ),
)]
pub async fn close_abandoned_turns<R, Rt>(
    repo: &R,
    realtime: &Rt,
    replica: ReplicaId,
    quiet_for: Duration,
    limit: NonZeroUsize,
) -> Result<AbandonedTurnSweep>
where
    R: AbandonedTurnRepo + SessionOwnership + AgentSessionRepo + AgentSessionLogRepo + Clone,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
{
    let sessions = repo.abandoned_turns(quiet_for, limit).await?;
    let mut sweep = AbandonedTurnSweep {
        examined: sessions.len(),
        closed: 0,
    };
    for session in sessions {
        match close_abandoned_turn(repo, realtime, replica, session).await {
            Ok(true) => sweep.closed += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(error = ?error, %session, "failed to close an abandoned agent session turn");
            }
        }
    }
    let span = tracing::Span::current();
    span.record("agent.sessions.examined", sweep.examined);
    span.record("agent.sessions.closed", sweep.closed);
    Ok(sweep)
}

/// Write the ending one abandoned session's log never got. `false` when
/// another replica holds it after all, so this pass leaves it alone.
async fn close_abandoned_turn<R, Rt>(
    repo: &R,
    realtime: &Rt,
    replica: ReplicaId,
    session: AgentSessionId,
) -> Result<bool>
where
    R: SessionOwnership + AgentSessionRepo + AgentSessionLogRepo + Clone,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
{
    // Take the lease before writing anything. The swap only succeeds against
    // an absent or stale holder, so a replica that picked this session back
    // up between the query and here keeps it - and because the append below
    // is fenced by this claim, a takeover racing us is rejected rather than
    // landing a disconnect in the middle of a turn that is running again.
    let claim = match repo.claim(session, replica).await? {
        ClaimOutcome::Claimed(claim) => claim,
        ClaimOutcome::ManagedElsewhere(holder) => {
            tracing::debug!(%session, %holder, "abandoned turn was picked back up before it could be closed");
            return Ok(false);
        }
    };
    let mut logs = LiveSessionLogWriter::fenced(repo.clone(), realtime.clone(), claim);
    let appended: Result<_> = logs
        .append(AgentSessionLog {
            agent_session_id: session,
            user_id: None,
            content: Message::ToServer(ToServerMessage::Event {
                event: SystemEvent::Disconnected,
            }),
        })
        .await;
    // Hold nothing afterwards: this replica ran a sweep, not the session, and
    // the next prompt should be free to open it wherever it lands.
    repo.release(&claim)
        .await
        .inspect_err(|error| {
            tracing::error!(error = ?error, %session, "failed to release the lease taken to close an abandoned turn");
        })
        .ok();
    appended.map(|_| true)
}
