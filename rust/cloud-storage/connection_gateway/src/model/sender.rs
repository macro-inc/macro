use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct MessageReceipt {
    /// The user id of the user who received the message
    pub user_id: String,
    /// The numer of times the message was delivered to the user
    pub delivery_count: u64,
    /// If one of those connections was active for the entity
    pub active: bool,
}
