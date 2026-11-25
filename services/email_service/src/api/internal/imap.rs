//! Authenticated engine wakeups; generation and credential policy live in the domain.

use crate::api::context::{ApiContext, AuthorizationService};
use axum::{Json, extract::State, http::StatusCode};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};

pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(input): Json<imap_service_client::Notification>,
) -> StatusCode {
    match ctx.imap_notifications.receive(input).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
