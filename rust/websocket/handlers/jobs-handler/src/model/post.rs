use serde::Serialize;

use super::job::JobId;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostData<'a> {
    pub event: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<&'a str>,
    pub job_id: &'a JobId<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<&'a str>,
    pub data: &'a serde_json::Value,
}
