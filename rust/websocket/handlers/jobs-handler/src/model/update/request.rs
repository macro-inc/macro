use serde::Deserialize;
use serde_json::Value;

use crate::model::job::JobStatus;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobUpdateHandlerRequestBody {
    pub job_id: String,
    pub status: JobStatus,
    pub data: Option<Value>,
}
