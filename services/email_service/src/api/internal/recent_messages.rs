//! The newest messages across a user's own inboxes, read straight from Gmail
//! and Outlook so callers get results before the mailbox has synchronized.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::domain::{
    mailbox::MailboxError,
    recent_inbox::{DEFAULT_RECENT_MESSAGES, DEFAULT_SNIPPET_CHARS},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use models_email::email::service::message::RecentInboxMessagesResponse;
use serde::Deserialize;

use crate::api::context::{ApiContext, AuthorizationService};

#[cfg(test)]
mod test;

#[derive(Debug, Deserialize)]
pub(crate) struct RecentMessagesQuery {
    /// 1 to 100; defaults to 50, and values outside the range are clamped.
    pub limit: Option<u16>,
    /// Snippet length, 1 to 500; defaults to the provider's 300. Longer
    /// snippets come from the body.
    pub snippet_chars: Option<u16>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum RecentMessagesError {
    #[error("invalid user id")]
    InvalidUser,
    #[error("the user's inboxes could not be read")]
    Inboxes(#[from] MailboxError),
}

impl IntoResponse for RecentMessagesError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::InvalidUser => StatusCode::BAD_REQUEST,
            Self::Inboxes(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// The user, limit and snippet length a request asks for.
fn parse_request(
    user_id: String,
    query: RecentMessagesQuery,
) -> Result<(MacroUserIdStr<'static>, u16, u16), RecentMessagesError> {
    let user = MacroUserIdStr::try_from(user_id).map_err(|_| RecentMessagesError::InvalidUser)?;
    Ok((
        user,
        query.limit.unwrap_or(DEFAULT_RECENT_MESSAGES),
        query.snippet_chars.unwrap_or(DEFAULT_SNIPPET_CHARS),
    ))
}

/// Up to `limit` of the newest messages across the user's own inboxes, newest
/// first. An inbox whose provider read fails is left out.
#[tracing::instrument(skip_all, err)]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(user_id): Path<String>,
    Query(query): Query<RecentMessagesQuery>,
) -> Result<Json<RecentInboxMessagesResponse>, RecentMessagesError> {
    let (user, limit, snippet_chars) = parse_request(user_id, query)?;
    let messages = ctx.recent_inbox.read(&user, limit, snippet_chars).await?;

    Ok(Json(RecentInboxMessagesResponse { messages }))
}
