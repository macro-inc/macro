//! An explicit public projection of the persisted execution journal.
use crate::domain::{
    ExecutionActivity, ExecutionId, ExecutionRecord, ExecutionStatus, RecordedToolCall,
};
use ai_toolset::actor::ToolActor;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

/// Reader-facing execution data. Internal credential bindings never enter this DTO.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecordResponse {
    execution_id: ExecutionId,
    acting_as: Option<ToolActor>,
    turn_id: Option<Uuid>,
    source: String,
    status: ExecutionStatus,
    result: Option<Value>,
    error: Option<String>,
    calls: Vec<RecordedToolCall>,
    activity: Vec<ExecutionActivity>,
    activity_truncated: bool,
}
impl From<ExecutionRecord> for ExecutionRecordResponse {
    fn from(record: ExecutionRecord) -> Self {
        Self {
            execution_id: record.execution_id,
            acting_as: record.acting_as,
            turn_id: record.turn_id,
            source: record.source,
            status: record.status,
            result: record.result,
            error: record.error,
            calls: record.calls,
            activity: record.activity,
            activity_truncated: record.activity_truncated,
        }
    }
}
