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

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ToWebsocketMessage {
    #[serde(rename = "track_entity")]
    TrackEntityMessage(TrackEntityMessage),
}
