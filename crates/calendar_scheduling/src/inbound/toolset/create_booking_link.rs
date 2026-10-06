use super::*;
use crate::domain::booking_links::BookingLinkDraft;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use serde::Deserialize;
use uuid::Uuid;

/// Create one booking link after user review.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "CreateBookingLink",
    description = "Create a reusable booking page, not a calendar meeting. First use ListBookingLinks to discover a suitable existing link or reuse availability. Supply a full draft with all seven weekdays (Sunday=0), IANA time zone, and real host IDs; personal links use the authenticated user and individual mode. For a team use a real team ID and collective or roundRobin mode. Set enabled only when the user wants to accept bookings. No invitations are sent by creating a link. Repeating an identical draft with the same slug reuses the saved link; a different draft at that slug conflicts. In chat and agent sessions this presents an editable review card: use it directly without an extra prose confirmation. Cancellation changes nothing. Headless clients apply their own confirmation policy before execution. Returns actual saved IDs, revision, full draft and shareable URL. Manual approval must be false; guest booking requires a connected, synced writable calendar."
)]
pub struct CreateBookingLink {
    /// Existing Macro team ID, or null for a personal booking link.
    pub team_id: Option<Uuid>,
    /// Full booking rules and availability for review. No other links are modified.
    pub draft: BookingLinkDraft,
}
impl ToolAnnotated for CreateBookingLink {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Create booking link").with_idempotent();
}
#[async_trait]
impl<Scheduling: BookingLinks> AsyncTool<BookingLinkToolContext<Scheduling>> for CreateBookingLink {
    type Output = BookingLinkResult;
    async fn call(
        &self,
        context: ServiceContext<BookingLinkToolContext<Scheduling>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let context = context.0;
        let link = context
            .service
            .create_link(request.user_id.as_ref(), self.team_id, self.draft.clone())
            .await
            .map_err(tool_error)?;
        Ok(context.result(link))
    }
}
