//! The agent inbox sweep: finishes wind-downs email_service hasn't
//! confirmed (an agent removed, a team deleted, a provision that lost the
//! race to a removal). Every call it makes is idempotent, so every replica
//! may run it.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::domain::inbox::{AgentInboxRepository, AgentMailboxes, InboxService, SWEEP_BATCH};

/// How long after start the first round runs.
pub const INBOX_SWEEP_INITIAL_DELAY: Duration = Duration::from_secs(30);

/// How long between rounds.
pub const INBOX_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Run sweep rounds until `shutdown` resolves; a full batch runs the next
/// round at once. Each round is its own trace (`team_agents.inbox.sweep`).
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
        wait = match inboxes.sweep_once(chrono::Utc::now()).await {
            Ok(found) if found >= SWEEP_BATCH as usize => Duration::ZERO,
            Ok(_) => interval,
            Err(error) => {
                tracing::warn!(error = ?error, "agent inbox sweep failed");
                interval
            }
        };
    }
}
