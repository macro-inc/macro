use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use gmail_client::GmailApiHttpError;
use model::response::ErrorResponse;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum ListBlockedError {
    #[error("Insufficient Gmail permissions. Please re-authenticate to grant the required scope.")]
    Forbidden,

    #[error("Gmail API error: {0}")]
    GmailError(String),

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for ListBlockedError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListBlockedError::Forbidden => StatusCode::FORBIDDEN,
            ListBlockedError::GmailError(_) | ListBlockedError::InternalError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

impl From<GmailApiHttpError> for ListBlockedError {
    fn from(error: GmailApiHttpError) -> Self {
        if error.status() == Some(StatusCode::FORBIDDEN) {
            return ListBlockedError::Forbidden;
        }
        ListBlockedError::GmailError(error.to_string())
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
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, gmail_token), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    gmail_token: Extension<String>,
) -> Result<Json<ListBlockedResponse>, ListBlockedError> {
    let blocked_emails = ctx
        .gmail_client
        .list_filters(&gmail_token)
        .await?
        .into_iter()
        .filter(|filter| {
            filter
                .action
                .add_label_ids
                .as_ref()
                .is_some_and(|labels| labels.iter().any(|label| label == "TRASH"))
        })
        .filter_map(|filter| filter.criteria.from)
        .collect();

    Ok(Json(ListBlockedResponse { blocked_emails }))
}
