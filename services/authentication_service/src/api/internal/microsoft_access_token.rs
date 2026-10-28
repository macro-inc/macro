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
pub struct TokenRequest {
    link_id: Uuid,
    generation: i64,
    sync_generation: i64,
    #[serde(default)]
    force_refresh: bool,
}

pub async fn handler(
    State(ctx): State<ApiContext>,
    _authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Query(request): Query<TokenRequest>,
) -> Response {
    let Some(service) = ctx.microsoft_auth else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match service
        .access_token(
            request.link_id,
            request.generation,
            request.sync_generation,
            request.force_refresh,
        )
        .await
    {
        Ok(token) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(serde_json::json!({"access_token":token.as_str(),"scopes":token.scopes})),
        )
            .into_response(),
        Err(
            MicrosoftAuthError::ReauthorizationRequired | MicrosoftAuthError::MissingPermissions,
        ) => StatusCode::UNAUTHORIZED.into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, "2")],
        )
            .into_response(),
    }
}

/// Internal teardown route; never accepted for active or superseded bindings.
pub async fn disconnect_handler(
    State(ctx): State<ApiContext>,
    _authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Query(request): Query<TokenRequest>,
) -> Response {
    let Some(service) = ctx.microsoft_auth else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match service
        .disconnect_token(request.link_id, request.generation, request.sync_generation)
        .await
    {
        Ok(token) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(serde_json::json!({"access_token":token.as_str(),"scopes":token.scopes})),
        )
            .into_response(),
        Err(
            MicrosoftAuthError::ReauthorizationRequired | MicrosoftAuthError::MissingPermissions,
        ) => StatusCode::UNAUTHORIZED.into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, "2")],
        )
            .into_response(),
    }
}
