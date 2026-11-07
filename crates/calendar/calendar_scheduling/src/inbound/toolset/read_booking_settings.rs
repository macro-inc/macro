use super::{BookingManagementToolContext, tool_error};
use crate::domain::{administration::SchedulingAdministration, models::*};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Read booking settings through the authorized scheduling service.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ReadBookingSettings",
    description = "Read the full personal or team Booking Links configuration: booking-page name and introduction, reusable schedules, default availability, and all link settings with IDs and revision. Omit teamId for personal. Discover team IDs using ListBookingLinks. This read does not create a profile. Use the returned profile with UpdateBookingSettings to change shared availability or page settings."
)]
pub struct ReadBookingSettings {
    /// Existing team ID from ListBookingLinks, or null for personal settings.
    pub team_id: Option<Uuid>,
}
/// Editable settings together with the public booking-page address.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingSettingsResult {
    /// Full settings, including the current revision for writes.
    pub profile: Profile,
    /// Public booking page; a revision-zero profile must be saved before sharing.
    pub page_url: String,
}
impl<Scheduling> BookingManagementToolContext<Scheduling> {
    pub(super) fn settings_result(&self, profile: Profile) -> BookingSettingsResult {
        let page_url = format!(
            "{}/app/book/{}",
            self.public_origin.trim_end_matches('/'),
            profile.id
        );
        BookingSettingsResult { profile, page_url }
    }
}
impl ToolAnnotated for ReadBookingSettings {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read booking settings");
}
#[async_trait]
impl<S: SchedulingAdministration> AsyncTool<BookingManagementToolContext<S>>
    for ReadBookingSettings
{
    type Output = BookingSettingsResult;
    async fn call(
        &self,
        context: ServiceContext<BookingManagementToolContext<S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let profile = context
            .0
            .service
            .settings(request.user_id.as_ref(), self.team_id)
            .await
            .map_err(tool_error)?;
        Ok(context.0.settings_result(profile))
    }
}
