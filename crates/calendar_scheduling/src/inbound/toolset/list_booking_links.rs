use super::*;
use crate::domain::models::Schedule;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use serde::Deserialize;
use uuid::Uuid;

/// Discover reusable links and everything needed to prepare an edit.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ListBookingLinks",
    description = "Discover and reuse the user's booking links before creating one. Returns shareable URLs, enabled/paused state, full drafts and revision for EditBookingLink, plus reusable availability schedules and the user's host ID. Searches title, slug and description; omit query for all (at most 100). Omit teamId for personal links; use a team ID returned in teamIds for team links. This read never creates settings. These are reusable scheduling pages, not calendar meetings."
)]
pub struct ListBookingLinks {
    /// Existing Macro team ID, or null for personal links.
    pub team_id: Option<Uuid>,
    /// Optional text to match in the link title, slug or description.
    pub query: Option<String>,
}
/// Authorized discovery results with shareable links.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBookingLinksResult {
    /// Current team IDs; call ListBookingLinks again with one as teamId to read team links.
    pub team_ids: Vec<Uuid>,
    /// Authenticated user's ID; use this host for a personal draft.
    pub user_id: String,
    /// Personal or team profile identity.
    pub profile_id: Uuid,
    /// Current profile revision for editing.
    pub revision: i64,
    /// Reusable availability to copy into a new draft.
    pub schedules: Vec<Schedule>,
    /// Matching links including their complete drafts.
    pub links: Vec<BookingLinkResult>,
}
impl ToolAnnotated for ListBookingLinks {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Find booking links");
}
#[async_trait]
impl<Scheduling: BookingLinks> AsyncTool<BookingLinkToolContext<Scheduling>> for ListBookingLinks {
    type Output = ListBookingLinksResult;
    async fn call(
        &self,
        context: ServiceContext<BookingLinkToolContext<Scheduling>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let context = context.0;
        let result = context
            .service
            .list_links(
                request.user_id.as_ref(),
                self.team_id,
                self.query.as_deref(),
            )
            .await
            .map_err(tool_error)?;
        Ok(ListBookingLinksResult {
            team_ids: result.team_ids,
            user_id: result.user_id,
            profile_id: result.profile_id,
            revision: result.revision,
            schedules: result.schedules,
            links: result
                .links
                .into_iter()
                .map(|link| context.result(link))
                .collect(),
        })
    }
}
