use crate::api::{
    context::ApiContext,
    oauth2::{OAuthState, account_link::build_callback_redirect},
};
use crate::domain::microsoft::MicrosoftAuthError;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;

pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    code: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    let id = state
        .link_id
        .ok_or_else(|| error_response(MicrosoftAuthError::InvalidAttempt))?;
    let service = ctx
        .microsoft_auth
        .as_ref()
        .ok_or_else(|| error_response(MicrosoftAuthError::NotConfigured))?;
    let return_uri = service
        .complete_link(id, &state.identity_provider_id, code)
        .await
        .map_err(error_response)?;
    match return_uri {
        Some(uri) => build_callback_redirect(&uri, &id).map_err(IntoResponse::into_response),
        None => Ok(StatusCode::OK.into_response()),
    }
}

fn error_response(error: MicrosoftAuthError) -> Response {
    let status = match error {
        MicrosoftAuthError::InvalidAttempt | MicrosoftAuthError::InvalidIdentity => {
            StatusCode::BAD_REQUEST
        }
        MicrosoftAuthError::OwnershipConflict => StatusCode::CONFLICT,
        MicrosoftAuthError::MissingPermissions => StatusCode::FORBIDDEN,
        MicrosoftAuthError::NotConfigured => StatusCode::NOT_FOUND,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    };
    (
        status,
        Json(ErrorResponse {
            message: error.to_string().into(),
        }),
    )
        .into_response()
}
