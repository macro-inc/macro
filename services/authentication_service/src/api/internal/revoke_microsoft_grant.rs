use crate::api::context::{ApiContext, AuthorizationService};
use axum::{Json, extract::State, http::StatusCode};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use uuid::Uuid;

#[derive(serde::Deserialize)]
pub struct Request {
    grant_id: Uuid,
    generation: i64,
    owner: String,
}

pub async fn handler(
    State(ctx): State<ApiContext>,
    _authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(request): Json<Request>,
) -> StatusCode {
    let Some(service) = ctx.microsoft_auth else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    match service
        .revoke_released_grant(request.grant_id, request.generation, &request.owner)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
