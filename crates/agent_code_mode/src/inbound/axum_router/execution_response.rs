//! The public execution response, separate from its persisted journal.
use crate::domain::ExecutionRecord;
use serde::Serialize;

/// Reader-facing execution data, projected from the persisted journal.
#[derive(Serialize)]
#[serde(transparent)]
pub struct ExecutionRecordResponse(ExecutionRecord);
impl From<ExecutionRecord> for ExecutionRecordResponse {
    fn from(record: ExecutionRecord) -> Self { Self(record) }
}
