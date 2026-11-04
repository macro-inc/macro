use crate::api::context::{ApiContext, AuthorizationService};
use crate::domain::microsoft::MicrosoftAuthError;
use axum::{
    Json,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use uuid::Uuid;

#[derive(serde::Deserialize)]
pub struct GrantRequest {
    attempt_id: Uuid,
    owner: Uuid,
}

pub async fn handler(
    State(ctx): State<ApiContext>,
    _authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Query(request): Query<GrantRequest>,
) -> Response {
    let Some(service) = ctx.microsoft_auth else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match service
        .completed_grant(request.attempt_id, request.owner)
        .await
    {
        Ok(grant) => ([(header::CACHE_CONTROL, "no-store")], Json(grant)).into_response(),
        Err(MicrosoftAuthError::InvalidAttempt | MicrosoftAuthError::MissingPermissions) => {
            StatusCode::FORBIDDEN.into_response()
        }
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}
