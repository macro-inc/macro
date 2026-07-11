//! Outbound port for product analytics emitted by the teams domain.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::TeamRole;

/// Product analytics events emitted by team lifecycle operations.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TeamAnalyticsEvent {
    /// A new team was created.
    TeamCreated {
        /// The id of the team that was created.
        team_id: uuid::Uuid,
        /// The macro user id of the user who owns the created team.
        owner_id: MacroUserIdStr<'static>,
        /// The name of the created team.
        team_name: String,
    },
    /// One user was invited to a team.
    TeamInvited {
        /// The id of the team that the user was invited to join.
        team_id: uuid::Uuid,
        /// The id of the team invite that was created.
        team_invite_id: uuid::Uuid,
        /// The macro user id of the user who created the invite.
        inviter_id: MacroUserIdStr<'static>,
        /// The team name, when it was available to the caller.
        team_name: Option<String>,
    },
    /// An invited user joined a team.
    TeamJoined {
        /// The id of the team that the user joined.
        team_id: uuid::Uuid,
        /// The id of the team invite that the user accepted.
        team_invite_id: uuid::Uuid,
        /// The macro user id of the user who joined the team.
        member_id: MacroUserIdStr<'static>,
        /// The role granted to the user who joined the team.
        role: TeamRole,
    },
    /// A member left or was removed from a team.
    TeamLeft {
        /// The id of the team that the user left.
        team_id: uuid::Uuid,
        /// The macro user id of the member who left the team.
        member_id: MacroUserIdStr<'static>,
        /// The macro user id of the user who removed the member.
        removed_by_id: MacroUserIdStr<'static>,
        /// The role the member had before leaving the team.
        role: TeamRole,
    },
}

/// Outbound port for recording team product analytics events.
pub trait TeamAnalytics: Clone + Send + Sync + 'static {
    /// Error type returned by the analytics implementation.
    type Err: std::fmt::Display + std::fmt::Debug + Send;

    /// Track one team analytics event.
    fn track_team_event(
        &self,
        event: TeamAnalyticsEvent,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// No-op team analytics implementation for callers without analytics wiring.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpTeamAnalytics;

impl TeamAnalytics for NoOpTeamAnalytics {
    type Err = std::convert::Infallible;

    async fn track_team_event(&self, _event: TeamAnalyticsEvent) -> Result<(), Self::Err> {
        Ok(())
    }
}
