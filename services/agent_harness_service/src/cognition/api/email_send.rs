//! HTTP adapter for sending an email the user has approved in conversation.
//!
//! It runs the `SendConfirmedEmail` tool as it is, so an agent's program
//! sends what the tool sends - a Markdown body, a chosen inbox, a reply in
//! its thread, Macro documents as attachments - behind the same
//! confirmation. The email service refuses a program's direct send, so this
//! and a review (`execution.reviews.create`) are the only ways a program
//! gets an email out.

use super::context::{ApiContext, DcsAuthorizationService};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::inbound::toolset::{SendConfirmedEmail, SendEmailResponse};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::GenericErrorResponse;

#[cfg(test)]
mod test;

/// A send that did not happen, with the reason the caller can act on.
#[derive(Debug)]
pub struct SendConfirmedEmailError {
    status: StatusCode,
    message: String,
}

impl IntoResponse for SendConfirmedEmailError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(GenericErrorResponse {
                error: true,
                message: self.message,
            }),
        )
            .into_response()
    }
}

#[utoipa::path(post, path = "/email/send-confirmed", operation_id = "send_confirmed_email",
    request_body(content = Object, description = "SendConfirmedEmail arguments: SendEmail's, plus userConfirmation"),
    responses(
        (status = 200, body = Object, description = "SendEmailResponse"),
        (status = 400, body = GenericErrorResponse, description = "Malformed, or missing userConfirmation"),
        (status = 401, description = "Unauthorized"),
        (status = 422, body = GenericErrorResponse, description = "Not sent: a blank confirmation, an inbox or attachment the user cannot use, or a delivery failure")))]
/// Send an email the user approved in conversation, quoting their approval.
#[tracing::instrument(skip_all, fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn send_confirmed_email(
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    body: Bytes,
) -> Result<Json<SendEmailResponse>, SendConfirmedEmailError> {
    let email: SendConfirmedEmail =
        serde_json::from_slice(&body).map_err(|error| SendConfirmedEmailError {
            status: StatusCode::BAD_REQUEST,
            message: format!("Invalid email: {error}"),
        })?;
    // The tool refuses a blank confirmation itself.
    let sent = email
        .call(
            ServiceContext(state.tool_service_context.email_tool_context.clone()),
            RequestContext::new(user.authorization.user.macro_user_id.clone()),
        )
        .await
        .map_err(|error| {
            tracing::warn!(error = ?error.internal_error, "confirmed email was not sent");
            SendConfirmedEmailError {
                status: StatusCode::UNPROCESSABLE_ENTITY,
                message: error.description,
            }
        })?;
    Ok(Json(sent))
}
