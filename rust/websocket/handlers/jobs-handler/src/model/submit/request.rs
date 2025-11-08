use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSubmissionHandlerRequestBody {
    pub action: String,
    pub request_id: String,
    pub data: Value,
}
