use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};

use frecency::domain::ports::AggregateFrecencyStorage;
use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use models_comms::channel::{Activity, ChannelId, ChannelWithLatest};
use uuid::Uuid;

use crate::domain::{
    models::channel_name::resolve_channel_name,
    ports::{ChannelsService, CommsRepo, UserRepo},
};

pub struct ChannelServiceImpl<Comms, Auth, Frec> {
    comms: Comms,
    auth: Auth,
    frecency: Frec,
}

impl<Comms, Auth, Frec> ChannelServiceImpl<Comms, Auth, Frec>
where
    Comms: CommsRepo,
    Auth: UserRepo,
    Frec: AggregateFrecencyStorage,
{
    pub fn new(comms: Comms, auth: Auth, frecency: Frec) -> Self {
        ChannelServiceImpl {
            comms,
            auth,
            frecency,
        }
    }
}

impl<Comms, Auth, Frec> ChannelsService for ChannelServiceImpl<Comms, Auth, Frec>
where
    Comms: CommsRepo,
    Auth: UserRepo,
    Frec: AggregateFrecencyStorage,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_channels(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<models_comms::channel::ChannelWithLatest>, rootcause::Report> {
        let channels = self
            .comms
            .get_user_channels_with_participants(user.copied())
            .await?;

        let channel_entities: Vec<_> = channels
            .iter()
            .map(|chan| EntityType::Channel.with_entity_string(chan.channel.id.0.to_string()))
            .collect();

        let channel_ids: Vec<_> = channels.iter().map(|chan| chan.channel.id).collect();

        let participant_ids: HashSet<_> = channels
            .iter()
            .flat_map(|chan| chan.participants.iter().map(|p| p.user_id.copied()))
            .collect();

        let (names, latest_messages, activities, frecency) = tokio::join!(
            self.auth.get_names_from_channels(participant_ids),
            self.comms.get_latest_channel_messages_batch(&channel_ids),
            self.comms.get_activities(user.copied()),
            self.frecency
                .get_aggregate_for_user_entities(user.clone(), channel_entities.as_slice())
        );

        let mut activity_lookup: HashMap<ChannelId, Activity> = activities
            .unwrap_or_default()
            .into_iter()
            .map(|a| (a.channel_id, a))
            .collect();

        let frecency_map: HashMap<ChannelId, f64> = frecency
            .unwrap_or_default()
            .into_iter()
            .filter_map(|f| {
                Some((
                    ChannelId(Uuid::from_str(&f.id.entity.entity_id).ok()?),
                    f.data.frecency_score,
                ))
            })
            .collect();

        let name_lookup = names.map(|n| {
            n.into_iter()
                .filter_map(|n| {
                    let display = n.display_name()?;
                    Some((n.id, display))
                })
                .collect::<HashMap<_, _>>()
        })?;

        let mut latest_messages = latest_messages?;

        // Map a channel to its correct name and latest message
        let channels: Vec<ChannelWithLatest> = channels
        .into_iter()
        .map(|mut channel| {
            let resolved_name = resolve_channel_name(
                &channel.channel.channel_type,
                channel.channel.name.as_deref(),
                &channel.participants,
                &channel.channel.id,
                user.copied(),
                &name_lookup,
            );
            channel.channel.name = Some(resolved_name);
            let activity = activity_lookup.remove(&channel.channel.id);
            let viewed_at = activity.as_ref().and_then(|a| a.viewed_at);
            let interacted_at = activity.as_ref().and_then(|a| a.interacted_at);
            let channel_with_latest = ChannelWithLatest {
                channel: channel.clone(),
                latest_message: latest_messages.remove(&channel.channel.id).unwrap_or_default(),
                viewed_at,
                interacted_at,
                frecency_score: frecency_map.get(&channel.channel.id).copied().unwrap_or_default()
            };

            tracing::trace!(channel_type=?channel.channel.channel_type,channel_name=?channel.channel.name, "resolved channel name");
            channel_with_latest
        })
        .collect();

        Ok(channels)
    }
}
