use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_api_client::domain::models::EmailApiError;
use model::response::ErrorResponse;
use models_email::service::link::Link;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error)]
pub enum ListBlockedError {
    #[error("Insufficient Gmail permissions. Please re-authenticate to grant the required scope.")]
    Forbidden,

    #[error("Email provider error: {0}")]
    Provider(EmailApiError),

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for ListBlockedError {
    fn into_response(self) -> Response {
        let (status_code, headers) = match &self {
            ListBlockedError::Forbidden => (StatusCode::FORBIDDEN, Default::default()),
            ListBlockedError::Provider(error) => (
                crate::api::email::provider_error::provider_error_status(error),
                crate::api::email::provider_error::provider_error_headers(error),
            ),
            ListBlockedError::InternalError(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, Default::default())
            }
        };

        (
            status_code,
            headers,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

impl From<EmailApiError> for ListBlockedError {
    fn from(error: EmailApiError) -> Self {
        if matches!(error, EmailApiError::Forbidden) {
            return ListBlockedError::Forbidden;
        }
        ListBlockedError::Provider(error)
    }
}

/// Response containing list of blocked email addresses.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListBlockedResponse {
    /// List of email addresses that are currently blocked.
    pub blocked_emails: Vec<String>,
}

/// List all blocked senders for the authenticated user.
#[utoipa::path(
    get,
    tag = "Contacts",
    path = "/email/contacts/blocked",
    operation_id = "list_blocked_senders",
    responses(
        (status = 200, body = ListBlockedResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, link), fields(link_id = %link.id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
) -> Result<Json<ListBlockedResponse>, ListBlockedError> {
    let blocked_emails = ctx.email_api.list_blocked_senders(link.id).await?;

    Ok(Json(ListBlockedResponse { blocked_emails }))
}
