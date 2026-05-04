use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct BulkWakeupRequest {
    pub document_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BulkWakeupResponse {
    pub dispatched: usize,
}
