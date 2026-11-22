//! An explicit public projection of the persisted execution journal.
use crate::domain::{
    ExecutionActivity, ExecutionId, ExecutionRecord, ExecutionStatus, RecordedToolCall,
};
use ai_toolset::actor::ToolActor;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

/// Durable source and final outcome, with historical bridge calls when present.
/// The full journal is not included in the model's tool result.
#[derive(Serialize, ToSchema)]
// Preserve the public component name while deriving it from the wire DTO.
#[schema(as = ExecutionRecord)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecordResponse {
    /// Execution identity.
    execution_id: ExecutionId,
    /// Account choice bound to this saved execution; absent on historical records.
    #[serde(default)]
    acting_as: Option<ToolActor>,
    /// Original turn, preventing another requester from replaying a saved result.
    #[serde(default)]
    turn_id: Option<Uuid>,
    /// The submitted TypeScript module.
    source: String,
    /// Overall execution state.
    status: ExecutionStatus,
    /// JSON returned by the program, if successful.
    result: Option<Value>,
    /// Safe execution failure text.
    error: Option<String>,
    /// Historical bridge calls. Direct HTTP executions leave this empty.
    calls: Vec<RecordedToolCall>,
    /// Advisory SDK operation activity, without arguments or response contents.
    #[serde(default)]
    activity: Vec<ExecutionActivity>,
    /// Additional request activity was omitted at the bounded observation limit.
    #[serde(default)]
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
