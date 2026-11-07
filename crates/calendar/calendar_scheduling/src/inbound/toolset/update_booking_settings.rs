use super::read_booking_settings::BookingSettingsResult;
use super::{BookingManagementToolContext, require_confirmation, tool_error};
use crate::domain::{administration::SchedulingAdministration, models::*};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

/// Update booking settings through the authorized scheduling service.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "UpdateBookingSettings",
    description = "Update Booking Links settings after reading ReadBookingSettings. Pass the full profile with its current revision, preserving fields the user did not request changing. Supports booking-page name and introduction; adding, editing and deleting reusable schedules and date overrides; changing defaultScheduleId; reassigning link schedules; duplicating, deleting, enabling or pausing links. Generate new UUIDs for new schedules, links and questions; preserve existing IDs. Changing a shared schedule affects every link referencing it and personal default hours affect team hosting. Deleting a link does not cancel existing bookings. Explain affected links before changing shared hours or deleting. A stale revision fails: re-read and reconcile rather than overwriting. Use CreateBookingLink or EditBookingLink for ordinary single-link authoring and their conversational confirmation contract. Any team member can edit team settings. Before saving, explain the proposed changes and their personal/team scope, ask whether to proceed, and wait for the user's approving reply in a later turn. Quote that reply verbatim in userConfirmation. Do not use the original request as confirmation."
)]
pub struct UpdateBookingSettings {
    /// Existing team ID from discovery, or null for personal settings.
    pub team_id: Option<Uuid>,
    /// Full desired profile including the revision read from ReadBookingSettings.
    pub profile: Profile,
    /// Verbatim user reply approving the proposed settings and affected links.
    pub user_confirmation: String,
}
impl ToolAnnotated for UpdateBookingSettings {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Update booking settings");
}
#[async_trait]
impl<S: SchedulingAdministration> AsyncTool<BookingManagementToolContext<S>>
    for UpdateBookingSettings
{
    type Output = BookingSettingsResult;
    async fn call(
        &self,
        context: ServiceContext<BookingManagementToolContext<S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        require_confirmation(&self.user_confirmation)?;
        let profile = context
            .0
            .service
            .save(request.user_id.as_ref(), self.team_id, self.profile.clone())
            .await
            .map_err(tool_error)?;
        Ok(context.0.settings_result(profile))
    }
}
