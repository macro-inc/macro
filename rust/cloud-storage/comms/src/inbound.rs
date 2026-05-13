#[cfg(feature = "inbound")]
mod router;
#[cfg(feature = "inbound")]
pub use router::{
    __path_get_activity_handler, __path_get_channels_handler, ApiActivity, ApiChannelWithLatest,
    Channel, ChannelMessage, ChannelParticipant, ChannelType, ChannelWithParticipants, CommsErr,
    CommsRouterState, LatestMessage, ParticipantRole, comms_router, get_activity_handler,
};
#[cfg(feature = "attachment")]
pub mod attachment;
