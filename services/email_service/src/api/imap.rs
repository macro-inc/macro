//! Authorized IMAP connection surfaces; ownership and retry policy live in the domain.

use super::context::{ApiContext, AuthorizationService};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header::RETRY_AFTER},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use email::domain::mailbox::imap_connection::{
    ImapConnectRequest, ImapConnectionError, ImapConnectionOffer,
};
use macro_authorization::{
    AccountHolderOrInternal, CredentialAttribution, CredentialOrigin, MacroAuthorizationExtractor,
    is_program_run,
};
use serde::Serialize;
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
/// Machine-readable reason an IMAP connection or settings request was refused.
#[derive(Clone, Copy, Serialize, ToSchema, strum_macros::IntoStaticStr)]
#[serde(rename_all = "snake_case", into = "&'static str")]
#[strum(serialize_all = "snake_case")]
pub(crate) enum ImapConnectionErrorCode {
    Disabled,
    AddressUnverified,
    ProviderConflict,
    ConnectionChanged,
    PaymentRequired,
    ConnectionUnavailable,
    Invalid,
    Forbidden,
    PersonRequired,
    NotFound,
    Conflict,
    CredentialsRejected,
    CredentialsUnreadable,
    CredentialsUnavailable,
    Throttled,
    DnsUnavailable,
    TcpUnavailable,
    TlsUnavailable,
    ConnectionTimedOut,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ImapConnectionErrorResponse {
    code: ImapConnectionErrorCode,
    message: String,
}

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub(crate) struct ConnectionError(#[from] ImapConnectionError);
impl IntoResponse for ConnectionError {
    fn into_response(self) -> Response {
        use ImapConnectionErrorCode as Code;
        use imap_service_client::Error;
        let (status, code) = match &self.0 {
            ImapConnectionError::PersonRequired => (StatusCode::FORBIDDEN, Code::PersonRequired),
            ImapConnectionError::Disabled => (StatusCode::FORBIDDEN, Code::Disabled),
            ImapConnectionError::AddressUnverified => {
                (StatusCode::FORBIDDEN, Code::AddressUnverified)
            }
            ImapConnectionError::ProviderConflict => (StatusCode::CONFLICT, Code::ProviderConflict),
            ImapConnectionError::Changed => (StatusCode::CONFLICT, Code::ConnectionChanged),
            ImapConnectionError::PaymentRequired => {
                (StatusCode::PAYMENT_REQUIRED, Code::PaymentRequired)
            }
            ImapConnectionError::Unavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, Code::ConnectionUnavailable)
            }
            ImapConnectionError::Provider(Error::Invalid) => {
                (StatusCode::BAD_REQUEST, Code::Invalid)
            }
            ImapConnectionError::Provider(Error::Forbidden) => {
                (StatusCode::FORBIDDEN, Code::Forbidden)
            }
            ImapConnectionError::Provider(Error::NotFound) => {
                (StatusCode::NOT_FOUND, Code::NotFound)
            }
            ImapConnectionError::Provider(Error::Conflict) => {
                (StatusCode::CONFLICT, Code::Conflict)
            }
            ImapConnectionError::Provider(Error::CredentialsRejected) => {
                (StatusCode::UNPROCESSABLE_ENTITY, Code::CredentialsRejected)
            }
            ImapConnectionError::Provider(Error::CredentialsUnreadable) => {
                (StatusCode::SERVICE_UNAVAILABLE, Code::CredentialsUnreadable)
            }
            ImapConnectionError::Provider(Error::CredentialsUnavailable) => (
                StatusCode::SERVICE_UNAVAILABLE,
                Code::CredentialsUnavailable,
            ),
            ImapConnectionError::Provider(
                Error::Throttled | Error::RateLimited { .. } | Error::AccountBusy,
            ) => (StatusCode::TOO_MANY_REQUESTS, Code::Throttled),
            ImapConnectionError::Provider(
                Error::CursorOutdated
                | Error::ConnectionUnavailable
                | Error::SendRejected
                | Error::SendUnavailable
                | Error::MessageTooLarge
                | Error::SnapshotTooLarge,
            ) => (StatusCode::BAD_GATEWAY, Code::ConnectionUnavailable),
            ImapConnectionError::Provider(Error::DnsUnavailable) => {
                (StatusCode::BAD_GATEWAY, Code::DnsUnavailable)
            }
            ImapConnectionError::Provider(Error::TcpUnavailable) => {
                (StatusCode::BAD_GATEWAY, Code::TcpUnavailable)
            }
            ImapConnectionError::Provider(Error::TlsUnavailable) => {
                (StatusCode::BAD_GATEWAY, Code::TlsUnavailable)
            }
            ImapConnectionError::Provider(Error::ConnectionTimedOut) => {
                (StatusCode::GATEWAY_TIMEOUT, Code::ConnectionTimedOut)
            }
        };
        let mut response = (
            status,
            Json(ImapConnectionErrorResponse {
                code,
                message: self.0.to_string(),
            }),
        )
            .into_response();
        if let ImapConnectionError::Provider(error) = self.0
            && let Some(seconds) = error.retry_after_seconds()
        {
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from(seconds));
        }
        response
    }
}

#[utoipa::path(
    get,
    path = "/email/links/suggestion",
    operation_id = "imap_suggestion",
    responses(
        (status = 200, body = ImapSuggestion),
        (status = 401, body = model::response::ErrorResponse),
        (status = 503, body = ImapConnectionErrorResponse)
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
    responses(
        (status = 200, body = imap_service_client::Discovery),
        (status = 401, body = model::response::ErrorResponse),
        (status = 403, body = ImapConnectionErrorResponse),
        (status = 429, body = ImapConnectionErrorResponse,
            headers(("Retry-After" = u32, description = "Minimum retry delay in seconds"))),
        (status = 502, body = ImapConnectionErrorResponse),
        (status = 503, body = ImapConnectionErrorResponse),
        (status = 504, body = ImapConnectionErrorResponse)
    )
)]
pub(crate) async fn discover(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
) -> Result<Json<imap_service_client::Discovery>, ConnectionError> {
    Ok(Json(
        ctx.imap_connections
            .discover(&authorization.authorization.user.macro_user_id)
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
        (status = 402, body = ImapConnectionErrorResponse),
        (status = 403, body = ImapConnectionErrorResponse),
        (status = 404, body = ImapConnectionErrorResponse),
        (status = 409, body = ImapConnectionErrorResponse),
        (status = 422, body = ImapConnectionErrorResponse),
        (status = 429, body = ImapConnectionErrorResponse,
            headers(("Retry-After" = u32, description = "Minimum retry delay in seconds"))),
        (status = 502, body = ImapConnectionErrorResponse),
        (status = 503, body = ImapConnectionErrorResponse),
        (status = 504, body = ImapConnectionErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn connect(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
    headers: HeaderMap,
    Json(input): Json<ImapConnectRequest>,
) -> Result<Json<ImapConnectResponse>, ConnectionError> {
    let user = authorization.authorization.user;
    authorize_connection_principal(&user.origin, user.attribution(), &headers)?;
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

fn authorize_connection_principal(
    origin: &CredentialOrigin,
    attribution: CredentialAttribution,
    headers: &HeaderMap,
) -> Result<(), ConnectionError> {
    if !matches!(origin, CredentialOrigin::Session) || is_program_run(attribution, headers) {
        return Err(ImapConnectionError::PersonRequired.into());
    }
    Ok(())
}

#[cfg(test)]
mod test;
