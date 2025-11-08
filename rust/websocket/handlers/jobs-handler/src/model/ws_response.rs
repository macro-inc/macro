use serde::Serialize;
use serde_json::{Error as SerdeError, Value};

use super::job::JobId;

#[derive(Serialize)]
pub enum Status {
    Success,
    Error,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse<'a> {
    pub job_id: &'a JobId<'a>,
    pub macro_request_id: &'a str,
    pub event: &'a str,
    pub data: Value,
    pub status: Status,
}

impl Default for SuccessResponse<'_> {
    fn default() -> Self {
        SuccessResponse {
            job_id: &JobId(""),
            macro_request_id: "",
            event: "",
            data: Value::Null,
            status: Status::Success,
        }
    }
}

impl TryInto<Vec<u8>> for SuccessResponse<'_> {
    type Error = SerdeError;

    fn try_into(self) -> Result<Vec<u8>, Self::Error> {
        serde_json::to_vec(&self)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<&'a JobId<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub macro_request_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<Value>,
    pub error: String,
    pub status: Status,
}

impl Default for ErrorResponse<'_> {
    fn default() -> Self {
        ErrorResponse {
            job_id: None,
            macro_request_id: None,
            event: None,
            request_body: None,
            error: "".to_string(),
            status: Status::Error,
        }
    }
}

impl TryInto<Vec<u8>> for ErrorResponse<'_> {
    type Error = SerdeError;

    fn try_into(self) -> Result<Vec<u8>, Self::Error> {
        serde_json::to_vec(&self)
    }
}
