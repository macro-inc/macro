//! Scheduling owns authorization and readiness of every attached destination.
use crate::domain::authoring::{AuthoringError, Code, ports::AuthoringBooking};
use calendar_scheduling::domain::{
    ports::{AttachmentReadiness, Directory, Repository},
    service::Service,
};
use databases::domain::models::Viewer;
use std::sync::Arc;

/// Calls Scheduling's authorized domain API, never its persistence adapter.
pub struct SchedulingTargets<R, C, D>(pub Arc<Service<R, C, D>>);
impl<R: Repository, C: AttachmentReadiness, D: Directory> AuthoringBooking
    for SchedulingTargets<R, C, D>
{
    async fn check_target(
        &self,
        actor: &Viewer,
        target: &models_forms::BookingTarget,
    ) -> Result<(), AuthoringError> {
        self.0
            .validate_attachment(
                actor.user_id.as_ref(),
                target.profile_id.into_uuid(),
                target.event_type_id.into_uuid(),
            )
            .await
            .map_err(|error| {
                AuthoringError::new(
                    Code::BookingTargetUnavailable,
                    "booking.target",
                    format!(
                        "Select an accessible, enabled booking link with a ready calendar: {error}"
                    ),
                )
            })
    }
}
