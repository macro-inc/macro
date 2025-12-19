use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct CreateNotification {
    /// The type of notification
    pub notification_event_type: String,
    /// The [Entity] the notification event was created for
    #[serde(flatten)]
    pub entity: model_entity::Entity<'static>,
    /// The service that created the notification
    pub service_sender: String,
    /// Custom metadata that may be needed for the notification
    pub metadata: Option<serde_json::Value>,
}
