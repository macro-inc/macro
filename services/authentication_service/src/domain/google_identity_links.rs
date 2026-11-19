//! Releases the Google identity link a connect attempt created when the
//! attempt ends without an inbox: refused by `/email/init`, or lapsed unused.
//!
//! A Gmail connect for a mailbox with no account of its own links the mailbox's
//! Google identity to the connecting account in FusionAuth, which binds an
//! identity to one user. Left behind, it makes every other account's connect
//! of that mailbox fail. Only a link the attempt itself created is released
//! (recorded at the OAuth callback), and never while the address has an account
//! of its own or the requester holds the inbox.

use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Attempts released per round.
const ATTEMPTS_PER_ROUND: i64 = 100;

/// A refused or lapsed attempt whose identity link it created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueAttempt {
    pub id: Uuid,
    pub fusionauth_user_id: Uuid,
    pub email: String,
}

pub trait IdentityLinkAttempts: Send + Sync {
    type Err: std::fmt::Debug;
    fn due(&self, limit: i64) -> impl Future<Output = Result<Vec<DueAttempt>, Self::Err>> + Send;
    /// Whether the link is still needed: the address has an account of its
    /// own, whose sign-in it is, or the requester holds the inbox.
    fn still_needed(
        &self,
        attempt: &DueAttempt,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    fn finish(&self, attempt: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

pub trait IdentityLinkRemover: Send + Sync {
    type Err: std::fmt::Debug;
    fn remove(
        &self,
        fusionauth_user_id: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReleaseRound {
    pub released: usize,
    pub kept: usize,
    pub failed: usize,
}

/// One round: release each due attempt's identity link, then drop the attempt.
/// An attempt whose release or bookkeeping fails stays due for the next round.
#[tracing::instrument(skip_all, fields(released, kept, failed), err(Debug))]
pub async fn release_identity_links<A: IdentityLinkAttempts, R: IdentityLinkRemover>(
    attempts: &A,
    remover: &R,
) -> Result<ReleaseRound, A::Err> {
    let mut round = ReleaseRound::default();
    for attempt in attempts.due(ATTEMPTS_PER_ROUND).await? {
        match release(attempts, remover, &attempt).await {
            Outcome::Released => round.released += 1,
            Outcome::Kept => round.kept += 1,
            Outcome::Failed => round.failed += 1,
        }
    }
    let span = tracing::Span::current();
    span.record("released", round.released);
    span.record("kept", round.kept);
    span.record("failed", round.failed);
    Ok(round)
}

enum Outcome {
    Released,
    /// Still needed: the attempt is dropped and the link kept.
    Kept,
    /// Left due for the next round.
    Failed,
}

async fn release<A: IdentityLinkAttempts, R: IdentityLinkRemover>(
    attempts: &A,
    remover: &R,
    attempt: &DueAttempt,
) -> Outcome {
    let needed = match attempts.still_needed(attempt).await {
        Ok(needed) => needed,
        Err(error) => {
            tracing::warn!(?error, attempt = %attempt.id, "could not check whether an attempt's identity link is still needed");
            return Outcome::Failed;
        }
    };
    if !needed
        && let Err(error) = remover
            .remove(attempt.fusionauth_user_id, &attempt.email)
            .await
    {
        tracing::warn!(?error, attempt = %attempt.id, "could not release an attempt's identity link");
        return Outcome::Failed;
    }
    if let Err(error) = attempts.finish(attempt.id).await {
        tracing::warn!(?error, attempt = %attempt.id, "could not drop a released attempt");
        return Outcome::Failed;
    }
    if needed {
        Outcome::Kept
    } else {
        Outcome::Released
    }
}
