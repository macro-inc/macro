use super::{BookingManagementToolContext, tool_error};
use crate::domain::administration::SchedulingAdministration;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

/// Booking insights through the authorized scheduling service.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "GetBookingInsights",
    description = "Get the same Booking Links summary statistics and chart data as Insights, for inclusive local dates in an IANA time zone (maximum 366 days). Returns current and equally long previous periods: total, completed, rescheduled, cancelled, host/guest no-shows, scheduled meeting minutes, average duration, daily trends, popular hours, and counts by link and host. Optional eventTypeId and hostId filters apply to both periods. Failed and processing requests are excluded. Completed means confirmed and ended without an explicit no-show, not verified attendance. Minutes are scheduled duration, not actual call duration. Rescheduled is counted once per booking. Dates use the booking current start. No guest contact information is returned."
)]
pub struct GetBookingInsights {
    /// Existing team ID, or null for personal insights.
    pub team_id: Option<Uuid>,
    /// Inclusive local date range, reporting time zone, and optional filters.
    pub query: crate::domain::insights::InsightQuery,
}
impl ToolAnnotated for GetBookingInsights {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Booking insights");
}
#[async_trait]
impl<S: SchedulingAdministration> AsyncTool<BookingManagementToolContext<S>>
    for GetBookingInsights
{
    type Output = crate::domain::insights::BookingInsights;
    async fn call(
        &self,
        context: ServiceContext<BookingManagementToolContext<S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .0
            .service
            .booking_insights(request.user_id.as_ref(), self.team_id, self.query.clone())
            .await
            .map_err(tool_error)
    }
}
