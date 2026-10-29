use crate::api::{ApiContext, context::AuthorizationService};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::message::RecentInboxMessagesResponse;
use serde::Deserialize;

/// More than this many messages adds provider reads without telling a reader
/// much more about the inbox.
const MAX_RECENT_MESSAGES: u16 = 50;

#[derive(Debug, Deserialize)]
pub struct RecentMessagesQuery {
    pub limit: Option<u16>,
}

/// The newest messages across a user's own inboxes, read straight from Gmail
/// and Outlook so callers get results before the mailbox has synchronized.
#[tracing::instrument(skip(ctx, _auth))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _auth: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(user_id): Path<String>,
    Query(query): Query<RecentMessagesQuery>,
) -> Response {
    let Ok(user) = MacroUserIdStr::try_from(user_id) else {
        return (StatusCode::BAD_REQUEST, "invalid user id").into_response();
    };
    let limit = query
        .limit
        .unwrap_or(MAX_RECENT_MESSAGES)
        .clamp(1, MAX_RECENT_MESSAGES);
    match ctx.recent_inbox.read(&user, limit).await {
        Ok(messages) => Json(RecentInboxMessagesResponse { messages }).into_response(),
        Err(error) => {
            tracing::error!(error = ?error, "could not read recent inbox messages");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
