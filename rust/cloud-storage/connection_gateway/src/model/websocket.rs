use super::tracking::TrackAction;
use model_entity::Entity;
use utoipa::ToSchema;

#[cfg(test)]
mod tests;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct TrackEntityMessage {
    #[serde(flatten)]
    pub extra: Entity<'static>,
    pub action: TrackAction,
}

/// subscribe to stream events from entity
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct StreamEvents {
    #[serde(flatten)]
    pub entity: Entity<'static>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ToWebsocketMessage {
    #[serde(rename = "track_entity")]
    TrackEntityMessage(TrackEntityMessage),
    #[serde(rename = "stream_events")]
    StreamEvents(StreamEvents),
}
