//! Authorized IMAP connection surfaces; ownership and retry policy live in the domain.

use super::context::{ApiContext, AuthorizationService};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use email::domain::mailbox::imap_connection::{
    ImapConnectRequest, ImapConnectionError, ImapConnectionOffer,
};
use macro_authorization::{AccountHolderOrInternal, MacroAuthorizationExtractor};
use macro_user_id::email::EmailStr;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub(crate) fn router() -> Router<ApiContext> {
    Router::new()
        .route("/suggestion", get(suggestion))
        .route("/imap/discover", post(discover))
        .route("/imap", post(connect))
        .route(
            "/{link_id}/imap/settings",
            get(super::imap_settings::get_settings).patch(super::imap_settings::update_settings),
        )
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ImapDiscoverRequest {
    #[schema(value_type = String, format = Email)]
    email: EmailStr<'static>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImapConnectResponse {
    link_id: Uuid,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImapSuggestion {
    email: String,
    offer: ImapConnectionOffer,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct ImapConnectionErrorResponse {
    code: String,
    message: String,
}

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub(crate) struct ConnectionError(ImapConnectionError);
impl From<ImapConnectionError> for ConnectionError {
    fn from(error: ImapConnectionError) -> Self {
        Self(error)
    }
}
impl IntoResponse for ConnectionError {
    fn into_response(self) -> Response {
        use imap_service_client::Error;
        let (status, code) = match &self.0 {
            ImapConnectionError::Disabled => (StatusCode::FORBIDDEN, "disabled"),
            ImapConnectionError::AddressUnverified => (StatusCode::FORBIDDEN, "address_unverified"),
            ImapConnectionError::ProviderConflict => (StatusCode::CONFLICT, "provider_conflict"),
            ImapConnectionError::Changed => (StatusCode::CONFLICT, "connection_changed"),
            ImapConnectionError::PaymentRequired => {
                (StatusCode::PAYMENT_REQUIRED, "payment_required")
            }
            ImapConnectionError::Unavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "connection_unavailable")
            }
            ImapConnectionError::Provider(Error::Invalid) => (StatusCode::BAD_REQUEST, "invalid"),
            ImapConnectionError::Provider(Error::Forbidden) => (StatusCode::FORBIDDEN, "forbidden"),
            ImapConnectionError::Provider(Error::NotFound) => (StatusCode::NOT_FOUND, "not_found"),
            ImapConnectionError::Provider(Error::Conflict) => (StatusCode::CONFLICT, "conflict"),
            ImapConnectionError::Provider(Error::CredentialsRejected) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "credentials_rejected")
            }
            ImapConnectionError::Provider(Error::CredentialsUnavailable) => {
                (StatusCode::SERVICE_UNAVAILABLE, "credentials_unavailable")
            }
            ImapConnectionError::Provider(Error::Throttled) => {
                (StatusCode::TOO_MANY_REQUESTS, "throttled")
            }
            ImapConnectionError::Provider(
                Error::CursorOutdated
                | Error::ConnectionUnavailable
                | Error::SendRejected
                | Error::SendUnavailable,
            ) => (StatusCode::BAD_GATEWAY, "connection_unavailable"),
            ImapConnectionError::Provider(Error::DnsUnavailable) => {
                (StatusCode::BAD_GATEWAY, "dns_unavailable")
            }
            ImapConnectionError::Provider(Error::TcpUnavailable) => {
                (StatusCode::BAD_GATEWAY, "tcp_unavailable")
            }
            ImapConnectionError::Provider(Error::TlsUnavailable) => {
                (StatusCode::BAD_GATEWAY, "tls_unavailable")
            }
            ImapConnectionError::Provider(Error::ConnectionTimedOut) => {
                (StatusCode::GATEWAY_TIMEOUT, "connection_timed_out")
            }
        };
        (
            status,
            Json(ImapConnectionErrorResponse {
                code: code.into(),
                message: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

#[utoipa::path(
    get,
    path = "/email/links/suggestion",
    operation_id = "imap_suggestion",
    responses(
        (status = 200, body = ImapSuggestion),
        (status = 401, body = model::response::ErrorResponse)
    )
)]
pub(crate) async fn suggestion(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
) -> Result<Json<ImapSuggestion>, ConnectionError> {
    let actor = &authorization.authorization.user.macro_user_id;
    let offer = ctx.imap_connections.suggestion(actor).await?;
    Ok(Json(ImapSuggestion {
        email: actor.email_str().into(),
        offer,
    }))
}

#[utoipa::path(
    post,
    path = "/email/links/imap/discover",
    operation_id = "imap_discover",
    request_body = ImapDiscoverRequest,
    responses(
        (status = 200, body = imap_service_client::Discovery),
        (status = 403, body = ImapConnectionErrorResponse)
    )
)]
pub(crate) async fn discover(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
    Json(input): Json<ImapDiscoverRequest>,
) -> Result<Json<imap_service_client::Discovery>, ConnectionError> {
    Ok(Json(
        ctx.imap_connections
            .discover(
                &authorization.authorization.user.macro_user_id,
                &input.email.0,
            )
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/email/links/imap",
    operation_id = "imap_connect",
    request_body = ImapConnectRequest,
    responses(
        (status = 200, body = ImapConnectResponse),
        (status = 400, body = ImapConnectionErrorResponse),
        (status = 403, body = ImapConnectionErrorResponse),
        (status = 409, body = ImapConnectionErrorResponse),
        (status = 422, body = ImapConnectionErrorResponse),
        (status = 429, body = ImapConnectionErrorResponse),
        (status = 502, body = ImapConnectionErrorResponse),
        (status = 503, body = ImapConnectionErrorResponse),
        (status = 504, body = ImapConnectionErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn connect(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
    Json(input): Json<ImapConnectRequest>,
) -> Result<Json<ImapConnectResponse>, ConnectionError> {
    let user = authorization.authorization.user;
    let link_id = ctx
        .imap_connections
        .connect(
            user.macro_user_id.clone(),
            &user.user_context.fusion_user_id.to_string(),
            input,
        )
        .await?;
    Ok(Json(ImapConnectResponse { link_id }))
}

#[cfg(test)]
mod test;
