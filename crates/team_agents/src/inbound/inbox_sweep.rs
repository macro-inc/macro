//! The agent inbox sweep: finishes wind-downs email_service hasn't
//! confirmed (an agent removed, a team deleted, a provision that lost the
//! race to a removal). Each round claims its marks, moving their next
//! attempt out by a backoff, so replicas split the work and a mark that
//! keeps failing is retried less often.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::domain::inbox::{AgentInboxRepository, AgentMailboxes, InboxService, SWEEP_BATCH};

/// How long after start the first round runs.
pub const INBOX_SWEEP_INITIAL_DELAY: Duration = Duration::from_secs(30);

/// How long between rounds.
pub const INBOX_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Run sweep rounds until `shutdown` resolves; a round that claimed a full
/// batch runs the next at once. Each round is its own trace
/// (`team_agents.inbox.sweep`).
pub async fn run_inbox_sweep<Repository, Mailboxes>(
    inboxes: Arc<InboxService<Repository, Mailboxes>>,
    initial_delay: Duration,
    interval: Duration,
    shutdown: impl Future<Output = ()> + Send,
) where
    Repository: AgentInboxRepository,
    Mailboxes: AgentMailboxes,
{
    tokio::pin!(shutdown);
    let mut wait = initial_delay;
    loop {
        tokio::select! {
            () = &mut shutdown => return,
            () = tokio::time::sleep(wait) => {}
        }
        // A round in flight is dropped at shutdown: every call it makes is
        // idempotent and its marks stay for the next start.
        let round = tokio::select! {
            () = &mut shutdown => return,
            round = inboxes.sweep_once(chrono::Utc::now(), SWEEP_BATCH) => round,
        };
        wait = match round {
            Ok(round) if round.claimed >= SWEEP_BATCH as usize => Duration::ZERO,
            Ok(_) => interval,
            Err(error) => {
                tracing::warn!(error = ?error, "agent inbox sweep failed");
                interval
            }
        };
    }
}
