//! Thin internal HTTP adapters. Account authorization and policy remain in Engine.
mod account_settings;
use crate::domain::{models::*, service::Engine};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use macro_user_id::email::EmailStr;
use std::sync::Arc;
use utoipa::OpenApi;
use uuid::Uuid;

/// Service-owned authenticated router state.
#[derive(Clone)]
pub struct ApiState {
    /// Business policy service.
    pub engine: Arc<Engine>,
    /// Service-specific internal key, redacted by omission from Debug.
    pub internal_key: String,
}
/// Construct the internal router, with health outside the authentication boundary.
pub fn router(state: ApiState) -> Router {
    let api = Router::new()
        .route("/discover", post(discover))
        .route("/verify", post(verify))
        .route("/accounts/{link}", put(connect).delete(disconnect))
        .route("/accounts/{link}/operations", post(operation))
        .route(
            "/accounts/{link}/settings",
            get(account_settings::account_mail_settings)
                .patch(account_settings::update_mail_settings),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate))
        .with_state(state);
    Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .nest("/internal/v1", api)
}
async fn authenticate(
    State(state): State<ApiState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let valid = !state.internal_key.is_empty()
        && request
            .headers()
            .get("x-internal-auth-key")
            .is_some_and(|provided| {
                bool::from(subtle::ConstantTimeEq::ct_eq(
                    provided.as_bytes(),
                    state.internal_key.as_bytes(),
                ))
            });
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"code":"forbidden"})),
        )
            .into_response();
    }
    next.run(request).await
}
/// Password-free discovery input.
#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRequest {
    /// User's verified sign-in address.
    #[schema(value_type = String, format = Email)]
    pub email: EmailStr<'static>,
}
/// Closed HTTP failure body. Provider text and credentials are never serialized.
pub struct ApiError(Error);
/// Closed error body for generated callers.
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    /// Closed failure category.
    pub code: Error,
    /// Minimum backoff for a retryable refusal.
    pub retry_after_seconds: Option<u32>,
}
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            Error::Invalid => StatusCode::UNPROCESSABLE_ENTITY,
            Error::Forbidden => StatusCode::FORBIDDEN,
            Error::NotFound => StatusCode::NOT_FOUND,
            Error::Conflict => StatusCode::CONFLICT,
            Error::CursorOutdated => StatusCode::GONE,
            Error::CredentialsRejected => StatusCode::UNAUTHORIZED,
            Error::CredentialsUnavailable
            | Error::CredentialsUnreadable
            | Error::ConnectionUnavailable
            | Error::DnsUnavailable
            | Error::TcpUnavailable
            | Error::TlsUnavailable
            | Error::SendUnavailable
            | Error::ConnectionTimedOut => StatusCode::SERVICE_UNAVAILABLE,
            Error::SendRejected => StatusCode::UNPROCESSABLE_ENTITY,
            Error::Throttled | Error::RateLimited { .. } | Error::AccountBusy => {
                StatusCode::TOO_MANY_REQUESTS
            }
            Error::MessageTooLarge | Error::SnapshotTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        };
        let (code, retry_after_seconds) = match self.0 {
            Error::RateLimited {
                retry_after_seconds,
            } => (Error::Throttled, Some(retry_after_seconds.clamp(1, 86_400))),
            Error::Throttled => (self.0, Some(60)),
            Error::AccountBusy => (self.0, Some(5)),
            _ => (self.0, None),
        };
        let mut response = (
            status,
            Json(serde_json::json!({
                "code": code,
                "retryAfterSeconds": retry_after_seconds,
            })),
        )
            .into_response();
        if let Some(seconds) = retry_after_seconds
            && let Ok(value) = axum::http::HeaderValue::from_str(&seconds.to_string())
        {
            response.headers_mut().insert("retry-after", value);
        }
        response
    }
}
fn binding(link: Uuid, headers: &HeaderMap) -> Result<Binding, ApiError> {
    let raw = headers
        .get("x-mailbox-binding")
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::Forbidden)?;
    use nom::{
        IResult, Parser,
        character::complete::{char, digit1},
        combinator::{all_consuming, map_res},
        sequence::separated_pair,
    };
    let number = |s: &str| s.parse::<i64>();
    let parsed: IResult<&str, (i64, i64)> = all_consuming(separated_pair(
        map_res(digit1, number),
        char('.'),
        map_res(digit1, number),
    ))
    .parse(raw);
    let (_, (sync_generation, grant_generation)) = parsed.map_err(|_| Error::Forbidden)?;
    Ok(Binding {
        link_id: link,
        sync_generation,
        grant_generation,
    })
}
#[utoipa::path(
    post,
    path = "/internal/v1/discover",
    request_body = DiscoveryRequest,
    responses(
        (status = 200, body = Discovery)
    )
)]
async fn discover(
    State(state): State<ApiState>,
    Json(input): Json<DiscoveryRequest>,
) -> Result<Json<Discovery>, ApiError> {
    Ok(Json(state.engine.discover_remote(&input.email.0).await?))
}
#[utoipa::path(
    post,
    path = "/internal/v1/verify",
    request_body = VerifyRequest,
    responses(
        (status = 200, body = Verification)
    )
)]
async fn verify(
    State(state): State<ApiState>,
    Json(input): Json<VerifyRequest>,
) -> Result<Json<Verification>, ApiError> {
    Ok(Json(state.engine.verify(input).await?))
}
#[utoipa::path(
    put,
    path = "/internal/v1/accounts/{link}",
    params(
        ("link" = Uuid, Path)
    ),
    request_body = ConnectRequest,
    responses(
        (status = 200, body = Binding)
    )
)]
async fn connect(
    State(state): State<ApiState>,
    Path(link): Path<Uuid>,
    Json(input): Json<ConnectRequest>,
) -> Result<Json<Binding>, ApiError> {
    Ok(Json(state.engine.connect(link, input).await?))
}
#[utoipa::path(
    delete,
    path = "/internal/v1/accounts/{link}",
    params(
        ("link" = Uuid, Path),
        ("x-mailbox-binding" = String, Header)
    ),
    responses(
        (status = 200),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn disconnect(
    State(state): State<ApiState>,
    Path(link): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    state.engine.delete(binding(link, &headers)?).await?;
    Ok(Json(serde_json::Value::Null))
}
#[utoipa::path(
    post,
    path = "/internal/v1/accounts/{link}/operations",
    params(
        ("link" = Uuid, Path),
        ("x-mailbox-binding" = String, Header),
        ("x-imap-work-class" = Option<OperationClass>, Header)
    ),
    request_body = Operation,
    responses(
        (status = 200, body = serde_json::Value),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 410, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 422, body = ErrorBody),
        (status = 429, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
async fn operation(
    State(state): State<ApiState>,
    Path(link): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<Operation>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        state
            .engine
            .execute_in_class(binding(link, &headers)?, input, operation_class(&headers)?)
            .await?,
    ))
}

fn operation_class(headers: &HeaderMap) -> Result<OperationClass, ApiError> {
    match headers.get("x-imap-work-class") {
        None => Ok(OperationClass::Interactive),
        Some(value) => Ok(value
            .to_str()
            .map_err(|_| Error::Invalid)?
            .parse()
            .map_err(|_| Error::Invalid)?),
    }
}
/// Source-of-truth OpenAPI document for the internal generated client.
#[derive(OpenApi)]
#[openapi(
    paths(
        discover,
        verify,
        connect,
        disconnect,
        operation,
        account_settings::account_mail_settings,
        account_settings::update_mail_settings
    ),
    components(schemas(
        ErrorBody,
        DiscoveryRequest,
        Discovery,
        Endpoint,
        TlsMode,
        VerifyRequest,
        Login,
        Secret,
        Verification,
        ConnectRequest,
        Binding,
        OperationClass,
        Operation,
        ActionRequest,
        DraftInput,
        AttachmentInput,
        Folder,
        FolderRole,
        Message,
        ChangePage,
        Draft,
        DraftAttachment,
        UploadSession,
        WriteReceipt,
        SubmissionOutcome,
        Error
    ))
)]
pub struct ApiDoc;

#[cfg(test)]
mod test;
