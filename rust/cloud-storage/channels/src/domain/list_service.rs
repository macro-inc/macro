//! Service implementation for legacy channel list APIs.

use std::{collections::HashMap, str::FromStr};

use frecency::domain::{models::AggregateFrecency, ports::AggregateFrecencyStorage};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use uuid::Uuid;

use crate::domain::{
    models::{Activity, ChannelType, ChannelWithLatest, GetChannelsRequest, UserName},
    ports::{ChannelListRepo, ChannelListService, ChannelListUserRepo},
};

/// Channel list service backed by channel, user, and frecency repositories.
pub struct ChannelListServiceImpl<Channels, Users, Frec> {
    channels: Channels,
    users: Users,
    frecency: Frec,
}

impl<Channels, Users, Frec> ChannelListServiceImpl<Channels, Users, Frec>
where
    Channels: ChannelListRepo,
    Users: ChannelListUserRepo,
    Frec: AggregateFrecencyStorage,
{
    /// Create a new channel list service.
    pub fn new(channels: Channels, users: Users, frecency: Frec) -> Self {
        Self {
            channels,
            users,
            frecency,
        }
    }
}

impl<Channels, Users, Frec> ChannelListService for ChannelListServiceImpl<Channels, Users, Frec>
where
    Channels: ChannelListRepo,
    Users: ChannelListUserRepo,
    Frec: AggregateFrecencyStorage,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_channels(
        &self,
        req: GetChannelsRequest,
    ) -> Result<Vec<ChannelWithLatest>, rootcause::Report> {
        let params = req.into_params();
        let user = params.user().clone();

        let channels = self
            .channels
            .get_user_channels_with_participants(params)
            .await?;

        let channel_entities: Vec<_> = channels
            .iter()
            .map(|chan| EntityType::Channel.with_entity_string(chan.channel.id.to_string()))
            .collect();

        let channel_ids: Vec<_> = channels.iter().map(|chan| chan.channel.id).collect();

        let participant_ids = channels
            .iter()
            .flat_map(|chan| chan.participants.iter().map(|p| p.user_id.as_str()))
            .filter_map(|id| {
                MacroUserIdStr::parse_from_str(id)
                    .ok()
                    .map(|id| id.into_owned())
            })
            .collect();

        let (names, latest_messages, activities, frecency) = tokio::join!(
            self.users.get_names_for_ids(participant_ids),
            self.channels
                .get_latest_channel_messages_batch(&channel_ids),
            self.channels.get_channel_list_activities(user.clone()),
            self.frecency
                .get_aggregate_for_user_entities(user.clone(), channel_entities.as_slice())
        );

        let mut activity_lookup: HashMap<Uuid, Activity> = activities
            .unwrap_or_default()
            .into_iter()
            .map(|a| (a.channel_id, a))
            .collect();

        let mut frecency_map: HashMap<Uuid, AggregateFrecency> = frecency
            .unwrap_or_default()
            .into_iter()
            .filter_map(|f| match Uuid::from_str(&f.id.entity.entity_id) {
                Ok(channel_id) => Some((channel_id, f)),
                Err(error) => {
                    tracing::warn!(
                        %error,
                        entity_id = %f.id.entity.entity_id,
                        "invalid channel entity id in frecency result"
                    );
                    None
                }
            })
            .collect();

        let name_lookup = names.map(|n| {
            n.into_iter()
                .filter_map(|n| {
                    let display = n.display_name()?;
                    Some((n.id.to_string(), display))
                })
                .collect::<HashMap<_, _>>()
        })?;

        let mut latest_messages = latest_messages?;

        Ok(channels
            .into_iter()
            .map(|mut channel| {
                let resolved_name = resolve_channel_name(
                    channel.channel.channel_type,
                    channel.channel.name.as_deref(),
                    channel.channel.id,
                    user.as_ref(),
                    &channel.participants,
                    &name_lookup,
                );
                channel.channel.name = Some(resolved_name);
                let activity = activity_lookup.remove(&channel.channel.id);
                let viewed_at = activity.as_ref().and_then(|a| a.viewed_at);
                let interacted_at = activity.as_ref().and_then(|a| a.interacted_at);
                let channel_id = channel.channel.id;
                ChannelWithLatest {
                    channel,
                    latest_message: latest_messages.remove(&channel_id).unwrap_or_default(),
                    viewed_at,
                    interacted_at,
                    frecency_score: frecency_map.remove(&channel_id),
                }
            })
            .collect())
    }

    fn get_activities(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Activity>, rootcause::Report>> + Send {
        self.channels.get_channel_list_activities(user)
    }

    fn get_names(
        &self,
        names: std::collections::HashSet<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<Vec<UserName>, rootcause::Report>> + Send {
        self.users.get_names_for_ids(names)
    }
}

fn resolve_channel_name(
    channel_type: ChannelType,
    stored_name: Option<&str>,
    channel_id: Uuid,
    viewer_user_id: &str,
    participants: &[crate::domain::models::ChannelParticipant],
    name_lookup: &HashMap<String, String>,
) -> String {
    if let Some(name) = stored_name.filter(|name| !name.is_empty()) {
        return name.to_string();
    }

    match channel_type {
        ChannelType::Public | ChannelType::Team => format!("#{}", &channel_id.to_string()[..8]),
        ChannelType::Private => {
            let mut names: Vec<_> = participants
                .iter()
                .filter(|p| p.user_id != viewer_user_id)
                .map(|p| display_name(&p.user_id, name_lookup))
                .collect();
            names.sort();
            if names.is_empty() {
                "Private channel".to_string()
            } else {
                names.join(", ")
            }
        }
        ChannelType::DirectMessage => participants
            .iter()
            .find(|p| p.user_id != viewer_user_id)
            .map(|p| display_name(&p.user_id, name_lookup))
            .unwrap_or_else(|| "Direct message".to_string()),
    }
}

fn display_name(user_id: &str, name_lookup: &HashMap<String, String>) -> String {
    name_lookup
        .get(user_id)
        .cloned()
        .unwrap_or_else(|| user_id.to_string())
}
