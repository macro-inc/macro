//! Teams' team-channel port, served by the channels domain.

use std::collections::HashSet;

use channels::domain::{
    models::{ChannelType, CreateChannelRequest, Sender},
    ports::{ChannelMutationErr, ChannelService},
};
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::team_channels::TeamChannels;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The channel service, in the terms the team service needs.
#[derive(Clone)]
pub struct ChannelServiceTeamChannels<S>(pub S);

/// The team channel a team gets on creation: owned by its owner, and
/// auto-joined by every member.
fn team_channel_request(
    team_id: Uuid,
    name: String,
    owner: MacroUserIdStr<'static>,
) -> CreateChannelRequest {
    CreateChannelRequest {
        name: Some(name),
        channel_type: ChannelType::Team,
        team_id: Some(team_id),
        auto_join_team: true,
        participants: HashSet::from([owner]),
    }
}

impl<S> TeamChannels for ChannelServiceTeamChannels<S>
where
    S: ChannelService + Clone,
{
    type Err = ChannelMutationErr;

    async fn create_team_channel(
        &self,
        team_id: Uuid,
        name: String,
        owner: MacroUserIdStr<'static>,
    ) -> Result<(), ChannelMutationErr> {
        self.0
            .create_channel(
                Sender::new_from_user(owner.clone()),
                None,
                team_channel_request(team_id, name, owner),
            )
            .await
            .map(|_| ())
    }

    async fn join_team_channels(
        &self,
        team_id: &Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> Result<(), ChannelMutationErr> {
        self.0.auto_join_by_team_id(team_id, user).await
    }

    async fn leave_team_channels(
        &self,
        team_id: &Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Uuid>, ChannelMutationErr> {
        self.0.leave_by_team_id(team_id, user).await
    }

    async fn restore_channel_memberships(
        &self,
        user: &MacroUserIdStr<'_>,
        channel_ids: &[Uuid],
    ) -> Result<(), ChannelMutationErr> {
        self.0.restore_by_channel_ids(user, channel_ids).await
    }
}
