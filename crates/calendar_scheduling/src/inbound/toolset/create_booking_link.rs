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
    description = "Create a reusable booking page, not a calendar meeting. First use ListBookingLinks to discover a suitable existing link or reuse availability. Supply a full draft with all seven weekdays (Sunday=0), IANA time zone, and real host IDs; personal links use the authenticated user and individual mode. For a team use a real team ID and collective or roundRobin mode. Set enabled only when the user wants to accept bookings. No invitations are sent by creating a link. Repeating an identical draft with the same slug reuses the saved link; a different draft at that slug conflicts. Create or edit booking links only after conversational confirmation, with no review card or interactive form. First explain all proposed details clearly in your reply: personal or team ownership, named hosts and who attends, meeting name, description, duration, location or Google Meet, time zone, weekly hours and date exceptions, link name, buffers, minimum notice, booking window, slot interval, daily limit, guest questions and whether bookings are enabled. Ask whether to proceed and stop. Only in a later turn after the user approves that specific proposal, call this tool with their approving reply quoted verbatim in userConfirmation. The original request is not confirmation; never invent or paraphrase approval. Never ask the user for teamId, host IDs, schedule IDs, revisions or JSON: discover IDs with ListBookingLinks and ListTeamMembers. Default to personal ownership unless a team is requested, and clarify ambiguous choices by name. Return the saved URL after execution. Returns actual saved IDs, revision, full draft and shareable URL. Manual approval must be false; guest booking requires a connected, synced writable calendar."
)]
pub struct CreateBookingLink {
    /// Existing Macro team ID discovered through tools, never requested from the user. Use null for a personal booking link.
    pub team_id: Option<Uuid>,
    /// Full booking rules and availability approved in conversation. No other links are modified.
    pub draft: BookingLinkDraft,
    /// The user's reply approving the specific proposal you already showed them, quoted verbatim.
    /// Never use their original request, paraphrase their reply, or invent approval.
    pub user_confirmation: String,
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
        require_confirmation(&self.user_confirmation)?;
        let context = context.0;
        let link = context
            .service
            .create_link(request.user_id.as_ref(), self.team_id, self.draft.clone())
            .await
            .map_err(tool_error)?;
        Ok(context.result(link))
    }
}
