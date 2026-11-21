//! The agent inbox sweep: finishes wind-downs email_service hasn't
//! confirmed (an agent removed, a team deleted, a provision that lost the
//! race to a removal). Every call it makes is idempotent, so every replica
//! may run it.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::domain::inbox::{
    AgentInboxRepository, AgentMailboxes, InboxService, SWEEP_BATCH, SweepRound,
};

/// How long after start the first round runs.
pub const INBOX_SWEEP_INITIAL_DELAY: Duration = Duration::from_secs(30);

/// How long between rounds.
pub const INBOX_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Run sweep rounds until `shutdown` resolves; a full page runs the next
/// page at once. Each round is its own trace (`team_agents.inbox.sweep`).
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
    let mut after = None;
    loop {
        tokio::select! {
            () = &mut shutdown => return,
            () = tokio::time::sleep(wait) => {}
        }
        // A full page goes on to the next one at once; the end of the list
        // (or a failed read) starts over after `interval`. Marks that can't
        // be finished stay behind the cursor, so they are never re-read
        // until the next pass.
        (wait, after) = match inboxes
            .sweep_once(chrono::Utc::now(), after.as_ref(), SWEEP_BATCH)
            .await
        {
            Ok(SweepRound {
                next: Some(next), ..
            }) => (Duration::ZERO, Some(next)),
            Ok(SweepRound { next: None, .. }) => (interval, None),
            Err(error) => {
                tracing::warn!(error = ?error, "agent inbox sweep failed");
                (interval, None)
            }
        };
    }
}
