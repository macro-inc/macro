//! HTTP adapters for the actions a user approves in conversation: sending an
//! email and creating a calendar event.
//!
//! Each runs its confirmed tool (`SendConfirmedEmail`,
//! `CreateConfirmedCalendarEvent`) as it is, so an agent's program does what
//! the tool does - a Markdown email body, a chosen inbox, a reply in its
//! thread, Macro documents as attachments; an event with guests, a
//! conference or a Macro call - behind the same quoted confirmation. The
//! email and calendar services refuse a program's direct send or create, so
//! these and a review (`execution.reviews.create`) are the only ways a
//! program gets an email out or an event onto a calendar.

use super::context::{ApiContext, DcsAuthorizationService};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use calendar_events::inbound::toolset::{CreateConfirmedCalendarEvent, ToolCalendarEvent};
use email::inbound::toolset::{SendConfirmedEmail, SendEmailResponse};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::GenericErrorResponse;
use serde::de::DeserializeOwned;

#[cfg(test)]
mod test;

/// An action that did not happen, with the reason the caller can act on.
#[derive(Debug)]
pub struct ConfirmedActionError {
    status: StatusCode,
    message: String,
}

impl IntoResponse for ConfirmedActionError {
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

/// Decode a confirmed tool's arguments and run it as the caller. The tool
/// itself refuses a blank confirmation.
async fn run_confirmed<Tool, Context>(
    context: Context,
    user: &MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    body: &[u8],
) -> Result<Json<Tool::Output>, ConfirmedActionError>
where
    Tool: AsyncTool<Context> + DeserializeOwned,
    Context: Send + Sync + 'static,
{
    let tool: Tool = serde_json::from_slice(body).map_err(|error| ConfirmedActionError {
        status: StatusCode::BAD_REQUEST,
        message: format!("Invalid arguments: {error}"),
    })?;
    tool.call(
        ServiceContext(context),
        RequestContext::new(user.authorization.user.macro_user_id.clone()),
    )
    .await
    .map(Json)
    .map_err(|error| {
        tracing::warn!(error = ?error.internal_error, "confirmed action did not run");
        ConfirmedActionError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: error.description,
        }
    })
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
) -> Result<Json<SendEmailResponse>, ConfirmedActionError> {
    // A channel-mention bot's program never sends: its direct tools could
    // not, and its quoted approval is one it wrote itself.
    if email::is_channel_mention_run() {
        return Err(ConfirmedActionError {
            status: StatusCode::FORBIDDEN,
            message: email::CHANNEL_MENTION_SEND_REFUSAL.to_owned(),
        });
    }
    run_confirmed::<SendConfirmedEmail, _>(
        state.tool_service_context.email_tool_context.clone(),
        &user,
        &body,
    )
    .await
}

#[utoipa::path(post, path = "/calendar/events/create-confirmed", operation_id = "create_confirmed_calendar_event",
    request_body(content = Object, description = "CreateConfirmedCalendarEvent arguments: CreateCalendarEvent's, plus userConfirmation"),
    responses(
        (status = 200, body = Object, description = "ToolCalendarEvent"),
        (status = 400, body = GenericErrorResponse, description = "Malformed, or missing userConfirmation"),
        (status = 401, description = "Unauthorized"),
        (status = 422, body = GenericErrorResponse, description = "Not created: a blank confirmation, a calendar the user cannot write, or a provider failure")))]
/// Create a calendar event the user approved in conversation, quoting their approval.
#[tracing::instrument(skip_all, fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn create_confirmed_calendar_event(
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    body: Bytes,
) -> Result<Json<ToolCalendarEvent>, ConfirmedActionError> {
    run_confirmed::<CreateConfirmedCalendarEvent, _>(
        state.tool_service_context.calendar_tool_context.clone(),
        &user,
        &body,
    )
    .await
}
