use std::collections::{HashMap, HashSet};

use macro_user_id::user_id::MacroUserIdStr;
use models_comms::channel::{
    Activity, ChannelId, ChannelWithLatest, ChannelWithParticipants, LatestMessage,
};
use rootcause::Report;

use crate::domain::models::UserName;

pub trait CommsRepo: Send + Sync + 'static {
    fn get_user_channels_with_participants(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<ChannelWithParticipants>, Report>> + Send;

    fn get_latest_channel_messages_batch(
        &self,
        channels: &[ChannelId],
    ) -> impl Future<Output = Result<HashMap<ChannelId, LatestMessage>, Report>> + Send;

    fn get_activities(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Activity>, Report>> + Send;
}

pub trait UserRepo: Send + Sync + 'static {
    fn get_names_for_ids(
        &self,
        names: HashSet<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<Vec<UserName>, Report>> + Send;
}

pub trait ChannelsService: Send + Sync + 'static {
    fn get_channels(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<ChannelWithLatest>, Report>> + Send;

    fn get_activities(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Activity>, Report>> + Send;

    fn get_names(
        &self,
        names: HashSet<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<Vec<UserName>, Report>> + Send;
}
