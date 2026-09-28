//! Thin email authorization boundary for calendar invitation resolution.
use super::context::{ApiContext, AuthorizationService, EmailEntityAccessService};
use axum::{Json, extract::State, http::StatusCode};
use calendar_events::domain::invitations::InvitationResolution;
use entity_access::{
    domain::models::ViewAccessLevel, inbound::axum_extractors::ThreadAccessLevelExtractor,
};
use std::collections::HashMap;

#[utoipa::path(get, path = "/email/threads/{thread_id}/calendar-invitations", tag = "email",
    operation_id = "get_thread_calendar_invitations",
    params(("thread_id" = uuid::Uuid, Path, description = "Authorized email thread")),
    responses((status = 200, body = HashMap<String, InvitationResolution>), (status = 401), (status = 403)))]
pub(crate) async fn handler(
    State(state): State<ApiContext>,
    access: ThreadAccessLevelExtractor<
        ViewAccessLevel,
        EmailEntityAccessService,
        AuthorizationService,
    >,
) -> Result<Json<HashMap<String, InvitationResolution>>, StatusCode> {
    email::domain::invitation_resolution::resolve(
        state.invitation_resolver.as_ref(),
        &state.invitation_snapshots,
        access.entity_access_receipt,
    )
    .await
    .map(Json)
    .map_err(|error| {
        tracing::error!(error=?error, "invitation resolution failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}
