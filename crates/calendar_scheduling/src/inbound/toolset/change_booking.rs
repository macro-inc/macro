use super::{BookingManagementToolContext, tool_error};
use crate::domain::{administration::SchedulingAdministration, models::*};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

/// Change booking through the authorized scheduling service.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ChangeBooking",
    description = "Manage an existing Booking Links meeting found with ListBookings: cancel it, approve a legacy pending booking, record or clear attendance, or reschedule to a start returned by GetBookingRescheduleSlots. Cancellation, approval and rescheduling can notify attendees; explain the action and act only on user authorization. Attendance is available only after a confirmed meeting ends. Existing host/admin permissions and availability rules apply. Returns the actual saved booking; a failed or processing status requires reconciliation, not blind retries. This does not edit the reusable booking link."
)]
pub struct ChangeBooking {
    /// Existing booking ID discovered through ListBookings.
    pub booking_id: Uuid,
    /// Requested change to this meeting.
    pub change: crate::domain::management::BookingChange,
}
impl ToolAnnotated for ChangeBooking {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Change booking");
}
#[async_trait]
impl<S: SchedulingAdministration> AsyncTool<BookingManagementToolContext<S>> for ChangeBooking {
    type Output = Booking;
    async fn call(
        &self,
        context: ServiceContext<BookingManagementToolContext<S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .0
            .service
            .change_booking(
                request.user_id.as_ref(),
                self.booking_id,
                self.change.clone(),
            )
            .await
            .map_err(tool_error)
    }
}
