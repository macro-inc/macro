//! Outbound port for the channels that follow team membership.
//!
//! Every team has a team channel that members join and leave with the team.
//! The composition root serves this port from the channels domain, so teams
//! never depends on channel storage or the channel service.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Team-channel membership operations the team service needs.
pub trait TeamChannels: Clone + Send + Sync + 'static {
    /// Error returned when a channel operation fails.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Create the team's channel, owned by `owner`, which new members
    /// auto-join.
    fn create_team_channel(
        &self,
        team_id: Uuid,
        name: String,
        owner: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Add or reactivate `user` in every auto-join channel of the team.
    fn join_team_channels(
        &self,
        team_id: &Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Soft-leave `user` from every channel of the team, returning the
    /// channels whose membership changed.
    fn leave_team_channels(
        &self,
        team_id: &Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;

    /// Roll back a leave by restoring `user` in exactly `channel_ids`.
    fn restore_channel_memberships(
        &self,
        user: &MacroUserIdStr<'_>,
        channel_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
