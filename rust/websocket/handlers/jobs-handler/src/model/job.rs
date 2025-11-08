use chrono::{serde::ts_seconds_option, DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

pub struct AddJobInput<'a> {
    pub job_id: &'a JobId<'a>,
    pub request_id: &'a str,
    pub connection_id: &'a str,
    pub user_id: Option<&'a str>,
    pub email: Option<&'a str>,
    pub event: &'a str,
    pub document_id_job_type: Option<&'a str>,
}

pub struct UpdateJobStatusInput<'a> {
    pub job_id: &'a JobId<'a>,
    pub status: &'a JobStatus,
}

#[derive(Serialize, Debug)]
#[serde(transparent)]
pub struct JobId<'a>(pub &'a str);

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct JobSubmissionsTableKey<'a> {
    pub job_id: &'a JobId<'a>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct JobSubmission<'a> {
    pub job_id: Cow<'a, str>,
    pub request_id: Cow<'a, str>,
    pub connection_id: Cow<'a, str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Cow<'a, str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<Cow<'a, str>>,
    pub request_time: DateTime<Utc>,
    pub event: Cow<'a, str>,
    pub status: JobStatus,
    pub document_id_job_type: Option<Cow<'a, str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(with = "ts_seconds_option")]
    pub expires_at_seconds: Option<DateTime<Utc>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum JobStatus {
    Created,
    Submitted,
    Started,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIdJobData<'a> {
    /// The job may contain a document id
    pub document_id: Option<Cow<'a, str>>,
}
