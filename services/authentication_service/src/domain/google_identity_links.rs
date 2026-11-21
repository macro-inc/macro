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

/// What still depends on the identity link a due attempt created.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinkUse {
    /// Nothing: release it.
    Unused,
    /// The address has an account of its own, whose sign-in it is, or the
    /// requester holds the inbox: keep it.
    Backing,
    /// Another attempt of the requester's for the address is under way and
    /// may be connecting with it: decide once that attempt ends.
    Retrying,
}

pub trait IdentityLinkAttempts: Send + Sync {
    type Err: std::fmt::Debug;
    fn due(&self, limit: i64) -> impl Future<Output = Result<Vec<DueAttempt>, Self::Err>> + Send;
    /// Whether the requester has another attempt for the address past its
    /// callback, neither refused nor lapsed.
    fn retry_under_way(
        &self,
        attempt: &DueAttempt,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Whether the address has an account of its own or the requester holds
    /// a Gmail inbox for it.
    fn link_backs_something(
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
    pub deferred: usize,
    pub failed: usize,
}

/// One round: release each due attempt's identity link, then drop the attempt.
/// A deferred attempt, or one whose release or bookkeeping fails, stays due
/// for the next round.
#[tracing::instrument(skip_all, fields(released, kept, deferred, failed), err(Debug))]
pub async fn release_identity_links<A: IdentityLinkAttempts, R: IdentityLinkRemover>(
    attempts: &A,
    remover: &R,
) -> Result<ReleaseRound, A::Err> {
    let mut round = ReleaseRound::default();
    for attempt in attempts.due(ATTEMPTS_PER_ROUND).await? {
        match release(attempts, remover, &attempt).await {
            Outcome::Released => round.released += 1,
            Outcome::Kept => round.kept += 1,
            Outcome::Deferred => round.deferred += 1,
            Outcome::Failed => round.failed += 1,
        }
    }
    let span = tracing::Span::current();
    span.record("released", round.released);
    span.record("kept", round.kept);
    span.record("deferred", round.deferred);
    span.record("failed", round.failed);
    Ok(round)
}

/// Reads the retry first: a retry that connects commits its inbox before it
/// drops its attempt, so one gone by the second read is seen as that inbox.
async fn link_use<A: IdentityLinkAttempts>(
    attempts: &A,
    attempt: &DueAttempt,
) -> Result<LinkUse, A::Err> {
    if attempts.retry_under_way(attempt).await? {
        return Ok(LinkUse::Retrying);
    }
    Ok(if attempts.link_backs_something(attempt).await? {
        LinkUse::Backing
    } else {
        LinkUse::Unused
    })
}

enum Outcome {
    Released,
    /// Still needed: the attempt is dropped and the link kept.
    Kept,
    /// Left due until the requester's other attempt ends.
    Deferred,
    /// Left due for the next round.
    Failed,
}

async fn release<A: IdentityLinkAttempts, R: IdentityLinkRemover>(
    attempts: &A,
    remover: &R,
    attempt: &DueAttempt,
) -> Outcome {
    let link_use = match link_use(attempts, attempt).await {
        Ok(link_use) => link_use,
        Err(error) => {
            tracing::warn!(?error, attempt = %attempt.id, "could not check whether an attempt's identity link is still needed");
            return Outcome::Failed;
        }
    };
    let release = match link_use {
        LinkUse::Retrying => return Outcome::Deferred,
        LinkUse::Backing => false,
        LinkUse::Unused => true,
    };
    if release
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
    if release {
        Outcome::Released
    } else {
        Outcome::Kept
    }
}
