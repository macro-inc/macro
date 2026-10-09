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
    description = "Edit exactly one existing booking link. First read it with ListBookingLinks, preserve all settings the user did not request changing, and pass its revision and full edited draft. Changed availability applies only to this link; other links and personal default hours remain unchanged. A stale revision fails: read again and confirm the updated proposal in conversation instead of overwriting concurrent edits. Create or edit booking links only after conversational confirmation, with no review card or interactive form. First explain all proposed details clearly in your reply: personal or team ownership, named hosts and who attends, meeting name, description, duration, location or Google Meet, time zone, weekly hours and date exceptions, link name, buffers, minimum notice, booking window, slot interval, daily limit, guest questions and whether bookings are enabled. Ask whether to proceed and stop. Only in a later turn after the user approves that specific proposal, call this tool with their approving reply quoted verbatim in userConfirmation. The original request is not confirmation; never invent or paraphrase approval. Never ask the user for teamId, host IDs, schedule IDs, revisions or JSON: discover IDs with ListBookingLinks and ListTeamMembers. Default to personal ownership unless a team is requested, and clarify ambiguous choices by name. Return the saved URL after execution. Returns actual saved IDs, revision, full draft and shareable URL. Manual approval must be false; guest booking requires a connected, synced writable calendar."
)]
pub struct EditBookingLink {
    /// Existing Macro team ID discovered through tools, never requested from the user. Use null for a personal booking link.
    pub team_id: Option<Uuid>,
    /// Existing link identity returned by ListBookingLinks.
    pub event_type_id: Uuid,
    /// Revision returned by ListBookingLinks; guards against concurrent settings changes.
    pub expected_revision: i64,
    /// Full booking rules and availability approved in conversation. No other links are modified.
    pub draft: BookingLinkDraft,
    /// The user's reply approving the specific proposal you already showed them, quoted verbatim.
    /// Never use their original request, paraphrase their reply, or invent approval.
    pub user_confirmation: String,
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
        require_confirmation(&self.user_confirmation)?;
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
