//! Close abandoned runtime connections without replaying their work.

use std::num::NonZeroUsize;

use super::error::Result;
use super::model::{SessionClaim, StoredAgentSessionLog};
use super::ports::AgentSessionRealtime;

/// Atomic persistence boundary for recovery after a replica stops heartbeating.
pub trait StaleSessionRepo: Send + Sync {
    /// Return at most `limit` claims whose holder has missed the lease deadline.
    /// A draining but heartbeating holder is still alive and must be excluded.
    fn stale_claims(
        &self,
        limit: NonZeroUsize,
    ) -> impl Future<Output = Result<Vec<SessionClaim>>> + Send;

    /// Recheck the exact holder, fence, and heartbeat, then atomically revoke
    /// the claim, append `Disconnected`, and project its turn state. Return
    /// `None` if a heartbeat, takeover, release, or another recovery won.
    /// Revocation increments the fence so the old actor can never append again.
    fn disconnect_stale_claim(
        &self,
        claim: SessionClaim,
    ) -> impl Future<Output = Result<Option<StoredAgentSessionLog>>> + Send;
}

/// Reconcile one bounded batch and invalidate viewers after durable recovery.
/// This only closes runtime state: it never starts a runtime or retries work.
#[tracing::instrument(err, skip(repo, realtime))]
pub async fn recover_stale_sessions<R: StaleSessionRepo, Rt: AgentSessionRealtime>(
    repo: &R,
    realtime: &Rt,
    limit: NonZeroUsize,
) -> Result<usize> {
    let mut recovered = 0;
    for claim in repo.stale_claims(limit).await? {
        match repo.disconnect_stale_claim(claim).await {
            Ok(Some(_)) => {}
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(error = ?error, session_id = %claim.session, recovered, "failed to disconnect abandoned agent session");
                continue;
            }
        };
        recovered += 1;
        // A successor can append AcpReady immediately after the commit. Never
        // publish a delayed Disconnected live frame over that newer state:
        // viewers must refetch the log in durable order instead.
        realtime
            .publish_updated(claim.session)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, session_id = %claim.session, "failed to publish recovered session disconnect");
            })
            .ok();
        tracing::info!(session_id = %claim.session, replica_id = %claim.replica, fence = claim.fence.0, "disconnected abandoned agent session");
    }
    Ok(recovered)
}
