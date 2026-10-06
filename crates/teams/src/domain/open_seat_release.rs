//! Outbound port for releasing a member's open seat when they leave a team.
//!
//! The teams service uses this port to release that seat without depending on
//! a particular storage implementation.

use macro_user_id::user_id::MacroUserIdStr;
use std::convert::Infallible;

/// Releases a member's open seat for a team.
pub trait OpenSeatRelease: Clone + Send + Sync + 'static {
    /// Error returned when releasing an open seat fails.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Releases the open seat held by `member` on `team_id`.
    fn release(
        &self,
        team_id: uuid::Uuid,
        member: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// No-op open-seat release for callers that do not release seats.
#[derive(Clone, Debug)]
pub struct NoOpOpenSeatRelease;

impl OpenSeatRelease for NoOpOpenSeatRelease {
    type Err = Infallible;

    async fn release(
        &self,
        _team_id: uuid::Uuid,
        _member: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}
