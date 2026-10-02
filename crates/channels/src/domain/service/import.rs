//! Reserved onboarding creation, sharing archive persistence without replaying live effects.

use super::ChannelServiceImpl;
use crate::domain::{
    events::ChannelEvent,
    historical::{EnsuredChannel, HistoricalChannel, HistoricalChannelKind},
    models::{ChannelType, Sender},
    ports::{ChannelEventDispatcher, ChannelMutationErr, ChannelRepo, HistoricalChannelRepo},
};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;
use uuid::Uuid;

impl<R, E, P, F> ChannelServiceImpl<R, E, P, F>
where
    R: ChannelRepo + HistoricalChannelRepo,
    E: ChannelEventDispatcher,
{
    /// Create or reuse a reserved onboarding Team channel. Team membership is
    /// checked on every call; reuse never changes memberships, names or settings.
    /// Only initial creation emits the ordinary channel-created event.
    pub async fn create_reserved_team_channel(
        &self,
        owner: MacroUserIdStr<'static>,
        id: Uuid,
        team_id: Uuid,
        name: String,
        mut participants: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<EnsuredChannel, ChannelMutationErr> {
        let has_team = self
            .repo
            .user_has_team(owner.as_ref().to_string(), team_id)
            .await
            .map_err(|error| ChannelMutationErr::Repo(error.into()))?;
        if !has_team {
            return Err(ChannelMutationErr::Unauthorized(
                "you do not have access to that team".to_string(),
            ));
        }
        participants.insert(owner.clone());
        let channel = HistoricalChannel {
            id,
            name,
            kind: HistoricalChannelKind::Team(team_id),
            owner,
            participants,
            created_at: chrono::Utc::now(),
        };
        let ensured = self
            .repo
            .create_onboarding_channel(&channel)
            .await
            .map_err(ChannelMutationErr::Repo)?;
        if ensured.created {
            self.events.dispatch(ChannelEvent::ChannelCreated {
                channel_id: ensured.id,
                actor: Sender::new_from_user(channel.owner),
                on_behalf_of: None,
                channel_type: ChannelType::Team,
                channel_name: Some(channel.name),
                participant_user_ids: channel.participants.into_iter().collect(),
            });
        }
        Ok(ensured)
    }
}
