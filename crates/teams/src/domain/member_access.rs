//! Telling other domains that a member just lost what their role allowed.
//!
//! An admin who hosts an agent teammate on their own machine may host it
//! only while they are an admin of its team. Removing or demoting them takes
//! that away; the agent side follows at once through [`MemberAccessLost`]
//! instead of at its next sweep. `teams` cannot depend on agent teammates (they
//! are built on it), so the composition root supplies the port.

use std::{future::Future, pin::Pin};

use uuid::Uuid;

/// A boxed future, so the port can be shared as a trait object.
pub type MemberAccessFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send + 'a>>;

/// Told after a member of a team was removed or lost admin.
pub trait MemberAccessLost: std::fmt::Debug + Send + Sync + 'static {
    /// A member of `team_id` lost access. Failures are logged by the caller
    /// and never undo the change; whatever depends on it must also catch up
    /// on its own.
    fn member_access_lost(&self, team_id: Uuid) -> MemberAccessFuture<'_>;
}

/// Tells nobody. The default until a composition root wires a listener in.
#[derive(Debug)]
pub struct NoOpMemberAccessLost;

impl MemberAccessLost for NoOpMemberAccessLost {
    fn member_access_lost(&self, _team_id: Uuid) -> MemberAccessFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}
