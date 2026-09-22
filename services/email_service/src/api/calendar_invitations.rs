//! Thin email authorization boundary for calendar invitation resolution.
use super::context::{ApiContext, AuthorizationService, EmailEntityAccessService};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use calendar_events::domain::invitations::InvitationResolution;
use entity_access::{
    domain::models::ViewAccessLevel, inbound::axum_extractors::ThreadAccessLevelExtractor,
};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct InvitationPage {
    offset: Option<i64>,
    limit: Option<i64>,
}

#[utoipa::path(get, path = "/email/threads/{thread_id}/calendar-invitations", tag = "email",
    operation_id = "get_thread_calendar_invitations",
    params(("thread_id" = uuid::Uuid, Path, description = "Authorized email thread"), InvitationPage),
    responses((status = 200, body = HashMap<String, InvitationResolution>), (status = 401), (status = 403)))]
pub(crate) async fn handler(
    State(state): State<ApiContext>,
    access: ThreadAccessLevelExtractor<
        ViewAccessLevel,
        EmailEntityAccessService,
        AuthorizationService,
    >,
    Query(page): Query<InvitationPage>,
) -> Result<Json<HashMap<String, InvitationResolution>>, StatusCode> {
    if page.offset.is_some_and(|offset| offset < 0)
        || page.limit.is_some_and(|limit| !(1..=100).contains(&limit))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    email::domain::invitation_resolution::resolve(
        state.email_thread_state.service.as_ref(),
        state.invitation_resolver.as_ref(),
        &state.invitation_snapshots,
        access.entity_access_receipt,
        page.offset.unwrap_or(0),
        page.limit.unwrap_or(100),
        state.config.calendar_sync_enabled,
    )
    .await
    .map(Json)
    .map_err(|error| {
        tracing::error!(error=?error, "invitation resolution failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}
