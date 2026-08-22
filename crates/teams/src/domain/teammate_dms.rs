//! Ensure a direct message exists between a joining member and every teammate.

#[cfg(test)]
mod live;
#[cfg(test)]
mod test;

use std::future::Future;

use channels::domain::{
    dm::{EnsureDms, EnsureDmsSummary, ensure_dms_for_joining_member},
    ports::{ChannelMutationErr, ChannelService},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use crate::domain::{
    model::{TeamError, TeamWithMembers},
    team_repo::TeamRepository,
};

/// Loads a team's current members for teammate direct-message sync.
pub trait TeamRoster: Clone + Send + Sync + 'static {
    /// Return the team and its members, including the owner.
    fn team_with_members(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<TeamWithMembers, TeamError>> + Send;
}

impl<T: TeamRepository> TeamRoster for T {
    fn team_with_members(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<TeamWithMembers, TeamError>> + Send {
        self.get_team_by_id(team_id)
    }
}

/// Creates missing teammate direct-message channels.
pub trait TeammateDirectMessages: Clone + Send + Sync + 'static {
    /// Ensure every pair in `command` has a direct-message channel.
    fn ensure_dms(
        &self,
        command: EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send;
}

impl<T: ChannelService + Clone> TeammateDirectMessages for T {
    fn ensure_dms(
        &self,
        command: EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send {
        ChannelService::ensure_dms(self, command)
    }
}

/// Ensures teammate direct messages after a member joins.
pub trait TeammateDmService: Clone + Send + Sync + 'static {
    /// Create a DM between `member_id` and every other current teammate.
    fn ensure_for_joined_member(
        &self,
        team_id: &Uuid,
        member_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<EnsureDmsSummary, TeammateDmError>> + Send;
}

/// Failure while ensuring teammate direct messages.
#[derive(Debug, thiserror::Error)]
pub enum TeammateDmError {
    /// The team no longer exists, so there is no roster to sync.
    #[error("the team does not exist")]
    TeamDoesNotExist,
    /// The team roster could not be loaded.
    #[error(transparent)]
    Team(TeamError),
    /// Channel creation failed for the whole batch.
    #[error(transparent)]
    Channels(#[from] ChannelMutationErr),
    /// Some pairs in the batch could not be ensured.
    #[error("failed to ensure {failed} teammate direct messages")]
    Partial {
        /// Pairs created by this attempt.
        created: usize,
        /// Pairs that already had a channel.
        existing: usize,
        /// Pairs that failed.
        failed: usize,
    },
}

impl From<TeamError> for TeammateDmError {
    fn from(error: TeamError) -> Self {
        match error {
            TeamError::TeamDoesNotExist => Self::TeamDoesNotExist,
            error => Self::Team(error),
        }
    }
}

impl TeammateDmError {
    /// Whether the consumer should retry instead of committing the offset.
    pub fn is_transient(&self) -> bool {
        !matches!(self, Self::TeamDoesNotExist)
    }
}

/// Ensures teammate direct messages from a roster and channel service.
#[derive(Clone)]
pub struct TeammateDmServiceImpl<R, C> {
    team_roster: R,
    channels: C,
}

impl<R, C> TeammateDmServiceImpl<R, C> {
    /// Wire a roster source to the channel service that creates DMs.
    pub fn new(team_roster: R, channels: C) -> Self {
        Self {
            team_roster,
            channels,
        }
    }
}

impl<R, C> TeammateDmServiceImpl<R, C>
where
    R: TeamRoster,
    C: TeammateDirectMessages,
{
    /// Create a DM between `member_id` and every other current teammate.
    #[tracing::instrument(skip(self, member_id), err)]
    pub async fn ensure_for_joined_member(
        &self,
        team_id: &Uuid,
        member_id: &MacroUserIdStr<'_>,
    ) -> Result<EnsureDmsSummary, TeammateDmError> {
        self.ensure_joined_member(team_id, member_id).await
    }

    async fn ensure_joined_member(
        &self,
        team_id: &Uuid,
        member_id: &MacroUserIdStr<'_>,
    ) -> Result<EnsureDmsSummary, TeammateDmError> {
        let team_with_members = self.team_roster.team_with_members(team_id).await?;
        let joining_user = member_id.clone().into_owned();
        let roster = std::iter::once(team_with_members.team.owner_id).chain(
            team_with_members
                .members
                .into_iter()
                .map(|member| member.user_id),
        );
        let summary = self
            .channels
            .ensure_dms(ensure_dms_for_joining_member(joining_user, roster))
            .await?;
        if summary.failed > 0 {
            return Err(TeammateDmError::Partial {
                created: summary.created,
                existing: summary.existing,
                failed: summary.failed,
            });
        }
        Ok(summary)
    }
}

impl<R, C> TeammateDmService for TeammateDmServiceImpl<R, C>
where
    R: TeamRoster,
    C: TeammateDirectMessages,
{
    async fn ensure_for_joined_member(
        &self,
        team_id: &Uuid,
        member_id: &MacroUserIdStr<'_>,
    ) -> Result<EnsureDmsSummary, TeammateDmError> {
        self.ensure_joined_member(team_id, member_id).await
    }
}
