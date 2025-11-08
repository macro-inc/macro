use model_notifications::DeviceType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRequest {
    pub device_type: DeviceType,
    pub token: String,
}
