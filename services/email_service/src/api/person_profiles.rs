//! Public profiles of the people in an authorized thread.
use super::context::{ApiContext, AuthorizationService, EmailEntityAccessService};
use axum::{Json, extract::State, http::StatusCode};
use email::domain::person_profiles::{PersonProfile, PersonProfileError};
use entity_access::{
    domain::models::ViewAccessLevel, inbound::axum_extractors::ThreadAccessLevelExtractor,
};

/// Known profiles of the thread's senders and recipients, excluding the viewer.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ThreadPersonProfiles {
    profiles: Vec<PersonProfile>,
}

#[utoipa::path(get, path = "/email/threads/{thread_id}/person-profiles", tag = "email",
    operation_id = "get_thread_person_profiles",
    params(("thread_id" = uuid::Uuid, Path, description = "Authorized email thread")),
    responses((status = 200, body = ThreadPersonProfiles), (status = 401), (status = 403)))]
pub(crate) async fn thread(
    State(state): State<ApiContext>,
    access: ThreadAccessLevelExtractor<
        ViewAccessLevel,
        EmailEntityAccessService,
        AuthorizationService,
    >,
) -> Result<Json<ThreadPersonProfiles>, StatusCode> {
    state
        .person_profiles
        .thread_profiles(access.entity_access_receipt)
        .await
        .map(|profiles| Json(ThreadPersonProfiles { profiles }))
        .map_err(|error| match error {
            PersonProfileError::Unauthorized => StatusCode::UNAUTHORIZED,
            PersonProfileError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        })
}
