use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct CreateNotification {
    /// The type of notification
    pub notification_event_type: String,
    /// The item id the notification event was created for
    pub event_item_id: String,
    /// The item type (document, chat, project...)
    pub event_item_type: String,
    /// The service that created the notification
    pub service_sender: String,
    /// Custom metadata that may be needed for the notification
    pub metadata: Option<serde_json::Value>,
}
