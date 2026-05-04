use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct BulkWakeupRequest {
    pub document_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct BulkWakeupResponse {
    pub dispatched: usize,
}
