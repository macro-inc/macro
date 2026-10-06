use super::*;
use crate::domain::booking_links::BookingLinkDraft;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use serde::Deserialize;
use uuid::Uuid;

/// Edit one booking link after user review.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "EditBookingLink",
    description = "Edit exactly one existing booking link. First read it with ListBookingLinks, preserve all settings the user did not request changing, and pass its revision and full edited draft. Changed availability applies only to this link; other links and personal default hours remain unchanged. A stale revision fails: read again and present a fresh review instead of overwriting concurrent edits. In chat and agent sessions this presents an editable review card: use it directly without an extra prose confirmation. Cancellation changes nothing. Headless clients apply their own confirmation policy before execution. Returns actual saved IDs, revision, full draft and shareable URL. Manual approval must be false; guest booking requires a connected, synced writable calendar."
)]
pub struct EditBookingLink {
    /// Existing Macro team ID, or null for a personal booking link.
    pub team_id: Option<Uuid>,
    /// Existing link identity returned by ListBookingLinks.
    pub event_type_id: Uuid,
    /// Revision returned by ListBookingLinks; guards against concurrent settings changes.
    pub expected_revision: i64,
    /// Full booking rules and availability for review. No other links are modified.
    pub draft: BookingLinkDraft,
}
impl ToolAnnotated for EditBookingLink {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Edit booking link").with_idempotent();
}
#[async_trait]
impl<Scheduling: BookingLinks> AsyncTool<BookingLinkToolContext<Scheduling>> for EditBookingLink {
    type Output = BookingLinkResult;
    async fn call(
        &self,
        context: ServiceContext<BookingLinkToolContext<Scheduling>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let context = context.0;
        let link = context
            .service
            .edit_link(
                request.user_id.as_ref(),
                self.team_id,
                self.event_type_id,
                self.expected_revision,
                self.draft.clone(),
            )
            .await
            .map_err(tool_error)?;
        Ok(context.result(link))
    }
}
