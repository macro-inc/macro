//! ListCallRecords tool for listing the caller's recent call records.

use std::sync::Arc;

use crate::domain::{
    models::GetCallRecordsRequest,
    ports::{CallRecordQueryService, CallService},
};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use filter_ast::Expr;
use item_filters::ast::{LiteralTree, call::CallLiteral};
use models_pagination::{Query, SimpleSortMethod};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::CallToolContext;

/// Maximum call records returned by a single [`ListCallRecords`] invocation.
const LIST_LIMIT: u32 = 50;

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
    description = "List recent call records the user can access, ordered by start time descending. Results are scoped to channels the user is a member of. Transcripts are NOT included — call ReadCallRecord with a specific callId to fetch a transcript."
)]
pub struct ListCallRecords {
    /// Only include calls in this channel.
    #[schemars(
        description = "Optional channel id. When provided, only calls from that channel are returned."
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<Uuid>,

    /// Only include calls the caller attended (or did not attend).
    #[schemars(
        description = "Optional filter on whether the caller joined the call. true = only calls the user attended; false = only calls the user did not attend; omit to include both."
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

        let filter = build_filter(self.channel_id, self.attended);

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
                participants: r.participants.into_iter().map(|p| p.user_id).collect(),
                is_active: r.is_active,
            })
            .collect();

        Ok(ListCallRecordsResponse { records })
    }
}

fn build_filter(channel_id: Option<Uuid>, attended: Option<bool>) -> LiteralTree<CallLiteral> {
    let mut parts = Vec::new();
    if let Some(id) = channel_id {
        parts.push(Expr::Literal(CallLiteral::ChannelId(id)));
    }
    if let Some(a) = attended {
        parts.push(Expr::Literal(CallLiteral::Attended(a)));
    }

    let mut iter = parts.into_iter();
    let first = iter.next()?;
    let combined = iter.fold(first, Expr::and);
    Some(Arc::new(combined))
}
