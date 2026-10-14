//! List send-as aliases from Gmail.

use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_api_client::domain::models::{EmailApiError, TokenFreshness};
use model::response::ErrorResponse;
use models_email::api;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum ListSendAsError {
    #[error("Failed to fetch Gmail send-as aliases")]
    GmailApiError(#[from] gmail_client::GmailApiHttpError),
    #[error("Failed to get Gmail access token")]
    TokenError(#[from] EmailApiError),
}

impl IntoResponse for ListSendAsError {
    fn into_response(self) -> Response {
        match self {
            ListSendAsError::GmailApiError(_) | ListSendAsError::TokenError(_) => {
                (StatusCode::BAD_GATEWAY, self.to_string()).into_response()
            }
        }
    }
}

/// The response from the list send-as aliases endpoint.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListSendAsResponse {
    /// The list of send-as aliases for this inbox.
    pub aliases: Vec<api::send_as::SendAsAlias>,
}

/// List the user's send-as aliases (email addresses they can send as) for a
/// linked Gmail inbox.
#[utoipa::path(
    get,
    tag = "Settings",
    path = "/email/settings/send-as",
    operation_id = "list_send_as",
    responses(
        (status = 200, body = ListSendAsResponse),
        (status = 401, body = ErrorResponse),
        (status = 502, description = "Failed to communicate with Gmail"),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn list_send_as_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
) -> Result<Json<ListSendAsResponse>, ListSendAsError> {
    let access_token = ctx
        .email_api
        .get_access_token(link.id, TokenFreshness::Cached)
        .await?;

    let send_as_response = ctx
        .gmail_client
        .list_send_as(access_token.expose_secret())
        .await?;

    let aliases = send_as_response
        .send_as
        .unwrap_or_default()
        .into_iter()
        .map(api::send_as::SendAsAlias::from)
        .collect();

    Ok(Json(ListSendAsResponse { aliases }))
}
