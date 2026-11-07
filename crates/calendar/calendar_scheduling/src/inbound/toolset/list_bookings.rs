use super::{BookingManagementToolContext, tool_error};
use crate::domain::{administration::SchedulingAdministration, models::*};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// List bookings through the authorized scheduling service.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ListBookings",
    description = "Read every booking starting in a half-open timestamp range for personal or team Booking Links. Returns IDs, status, hosts, guest details, answers, attendance and reschedule history; use these IDs to manage meetings. Both timestamps are required, with an explicit UTC offset. Maximum range 733 days. Oversized result sets fail rather than silently truncating: narrow the range. Use GetBookingInsights for aggregate statistics."
)]
pub struct ListBookings {
    /// Existing team ID, or null for personal bookings.
    pub team_id: Option<Uuid>,
    /// Inclusive start timestamp.
    pub from: chrono::DateTime<chrono::Utc>,
    /// Exclusive end timestamp.
    pub to: chrono::DateTime<chrono::Utc>,
}
/// Authorized booking bookings.
#[derive(Debug, Serialize, JsonSchema)]
pub struct BookingsResult {
    /// Complete list of matching bookings.
    pub bookings: Vec<Booking>,
}
impl ToolAnnotated for ListBookings {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List bookings");
}
#[async_trait]
impl<S: SchedulingAdministration> AsyncTool<BookingManagementToolContext<S>> for ListBookings {
    type Output = BookingsResult;
    async fn call(
        &self,
        context: ServiceContext<BookingManagementToolContext<S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(BookingsResult {
            bookings: context
                .0
                .service
                .bookings_in_range(request.user_id.as_ref(), self.team_id, self.from, self.to)
                .await
                .map_err(tool_error)?,
        })
    }
}
