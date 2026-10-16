use super::{BookingManagementToolContext, tool_error};
use crate::domain::{administration::SchedulingAdministration, models::*};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Find replacement times through the authorized scheduling service.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "GetBookingRescheduleSlots",
    description = "Find available replacement times for a booking discovered through ListBookings. The date is in the booking schedule time zone. Only the personal owner, a host of the meeting or team administrators may reschedule it. Returns absolute start/end times for ChangeBooking reschedule; availability is checked again when moving the meeting."
)]
pub struct GetBookingRescheduleSlots {
    /// Existing booking ID from ListBookings.
    pub booking_id: Uuid,
    /// Date in the booking schedule time zone.
    pub date: chrono::NaiveDate,
}
/// Authorized booking slots.
#[derive(Debug, Serialize, JsonSchema)]
pub struct BookingSlotsResult {
    /// Complete list of matching slots.
    pub slots: Vec<Slot>,
}
impl ToolAnnotated for GetBookingRescheduleSlots {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Find replacement times");
}
#[async_trait]
impl<S: SchedulingAdministration> AsyncTool<BookingManagementToolContext<S>>
    for GetBookingRescheduleSlots
{
    type Output = BookingSlotsResult;
    async fn call(
        &self,
        context: ServiceContext<BookingManagementToolContext<S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(BookingSlotsResult {
            slots: context
                .0
                .service
                .host_replacement_slots(request.user_id.as_ref(), self.booking_id, self.date)
                .await
                .map_err(tool_error)?,
        })
    }
}
