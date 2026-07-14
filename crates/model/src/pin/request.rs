use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPinRequest {
    /// The id of the pinned item
    pub pinned_item_id: String,
    /// The type of the pin
    pub pinned_item_type: String,
    /// The index of the pin
    pub pin_index: i32,
}

impl ReorderPinRequest {
    pub fn new(pinned_item_id: &str, pinned_item_type: &str, pin_index: i32) -> Self {
        Self {
            pinned_item_id: pinned_item_id.to_string(),
            pinned_item_type: pinned_item_type.to_string(),
            pin_index,
        }
    }
}
