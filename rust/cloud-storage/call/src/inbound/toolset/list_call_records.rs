//! ListCallRecords tool for listing the caller's recent call records.

use std::sync::Arc;

use crate::domain::{
    models::GetCallRecordsRequest,
    ports::{CallRecordQueryService, CallService},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use filter_ast::Expr;
use item_filters::{
    CallStatus,
    ast::{LiteralTree, call::CallLiteral},
};
use models_pagination::{Query, SimpleSortMethod};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::CallToolContext;

/// Maximum call records returned by a single [`ListCallRecords`] invocation.
const LIST_LIMIT: u32 = 50;

/// Schema-only mirror of [`CallStatus`] without variant docs, keeping AI tool
/// schemas as a simple enum instead of `oneOf`.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ToolCallStatus {
    Attended,
    Missed,
    Unattended,
}

/// A call-record summary. Intentionally omits the transcript — use
/// [`super::read_call_record::ReadCallRecord`] to fetch it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CallRecordSummary {
    /// The call's unique identifier.
    pub call_id: Uuid,
    /// The channel the call belongs to.
    pub channel_id: Uuid,
    /// The channel's display name, if resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_name: Option<String>,
    /// The user who created the call.
    pub created_by: String,
    /// When the call started.
    pub started_at: DateTime<Utc>,
    /// When the call ended. Absent if the call is still active.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<DateTime<Utc>>,
    /// Call duration in milliseconds. Absent if the call is still active.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    /// The caller's viewer-relative status for this call.
    #[schemars(with = "Option<ToolCallStatus>")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<CallStatus>,
    /// IDs of users who participated in the call.
    pub participants: Vec<String>,
    /// True if the call is currently active.
    pub is_active: bool,
}

/// Response for [`ListCallRecords`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCallRecordsResponse {
    /// Call records ordered by start time descending.
    pub records: Vec<CallRecordSummary>,
}

/// Tool: list the caller's recent call records (transcripts excluded).
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListCallRecords",
    description = "List recent call records the user can access, ordered by start time descending. Status is relative to the caller. Transcripts are NOT included — call ReadCallRecord with a specific callId to fetch a transcript."
)]
pub struct ListCallRecords {
    /// Only include calls in this channel.
    #[schemars(
        description = "Optional channel id. When provided, only calls from that channel are returned."
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<Uuid>,

    /// Only include calls with this viewer-relative status for the caller.
    #[schemars(
        with = "Option<ToolCallStatus>",
        description = "Optional viewer-relative status filter. ATTENDED = calls the user joined; MISSED = calls the user did not join while they are in the channel; UNATTENDED = calls the user did not join while they are not in the channel. Prefer this over the deprecated attended filter."
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<CallStatus>,

    /// Deprecated compatibility filter for calls the caller attended (or did not attend).
    #[schemars(
        description = "Deprecated compatibility filter. true = only calls the user attended; false = only calls the user did not attend; omit to include both. Ignored when status is provided."
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attended: Option<bool>,
}

#[async_trait]
impl<CSvc, QSvc, ESvc> AsyncTool<CallToolContext<CSvc, QSvc, ESvc>> for ListCallRecords
where
    CSvc: CallService,
    QSvc: CallRecordQueryService,
    ESvc: EntityAccessService,
{
    type Output = ListCallRecordsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CallToolContext<CSvc, QSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "List call records");

        let filter = build_filter(self.channel_id, self.status, self.attended);

        let req = GetCallRecordsRequest {
            user_id: request_context.user_id.clone(),
            limit: LIST_LIMIT,
            query: Query::Sort(SimpleSortMethod::CreatedAt, filter),
        };

        let records = service_context
            .query_service
            .get_user_call_records(req)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to list call records".to_string(),
                internal_error: e.into(),
            })?;

        let records = records
            .into_iter()
            .map(|r| CallRecordSummary {
                call_id: r.call_id,
                channel_id: r.channel_id,
                channel_name: r.channel_name,
                created_by: r.created_by,
                started_at: r.started_at,
                ended_at: r.ended_at,
                duration_ms: r.duration_ms,
                status: r.status,
                participants: r.participants.into_iter().map(|p| p.user_id).collect(),
                is_active: r.is_active,
            })
            .collect();

        Ok(ListCallRecordsResponse { records })
    }
}

pub(super) fn build_filter(
    channel_id: Option<Uuid>,
    status: Option<CallStatus>,
    attended: Option<bool>,
) -> LiteralTree<CallLiteral> {
    let mut parts = Vec::new();
    if let Some(id) = channel_id {
        parts.push(Expr::Literal(CallLiteral::ChannelId(id)));
    }
    if let Some(status) = status {
        parts.push(Expr::Literal(CallLiteral::Status(status)));
    } else if let Some(attended) = attended {
        parts.push(Expr::Literal(CallLiteral::Attended(attended)));
    }

    let mut iter = parts.into_iter();
    let first = iter.next()?;
    let combined = iter.fold(first, Expr::and);
    Some(Arc::new(combined))
}
