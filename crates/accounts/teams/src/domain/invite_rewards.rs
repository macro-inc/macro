//! Rewards the person who brought a new member onto a team.
//!
//! Billing owns the reward itself; this crate only reports who earned one.
//! `teams` cannot depend on billing, so the composition root supplies the
//! [`InviteRewarder`].

use std::{future::Future, pin::Pin};

use macro_user_id::user_id::MacroUserIdStr;

/// Someone joined a team because of `inviter`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteRewardEvent {
    /// Who earned the reward: the invite's sender or the link's creator.
    pub inviter: MacroUserIdStr<'static>,
    /// Who joined.
    pub joined: MacroUserIdStr<'static>,
    /// A stable key for this join, so a retried join never pays twice.
    pub event_key: String,
}

/// A boxed future, so the rewarder can be shared as a trait object.
pub type InviteRewardFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send + 'a>>;

/// Books the reward for an [`InviteRewardEvent`].
pub trait InviteRewarder: std::fmt::Debug + Send + Sync + 'static {
    /// Rewards the inviter. Failures are logged by the caller and never undo
    /// the join.
    fn reward_inviter(&self, event: InviteRewardEvent) -> InviteRewardFuture<'_>;
}

/// Rewards nobody. The default until a composition root wires billing in.
#[derive(Debug)]
pub struct NoOpInviteRewarder;

impl InviteRewarder for NoOpInviteRewarder {
    fn reward_inviter(&self, _event: InviteRewardEvent) -> InviteRewardFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}
