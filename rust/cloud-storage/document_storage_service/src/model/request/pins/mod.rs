use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PinRequest {
    /// The type of the pin
    pub pin_type: String,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddPinRequest {
    /// The type of the pin
    pub pin_type: String,
    /// The index of the pin
    pub pin_index: i32,
}
