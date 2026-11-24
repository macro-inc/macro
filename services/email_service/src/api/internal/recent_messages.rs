//! The newest inbox messages or the last days of inbox or sent mail, read
//! straight from Gmail and Outlook before the user's mailboxes synchronize.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::domain::{
    mailbox::MailboxError,
    recent_inbox::{DEFAULT_RECENT_MESSAGES, DEFAULT_SNIPPET_CHARS, RecentMailFolder, WindowRead},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use models_email::email::service::message::RecentInboxMessagesResponse;
use serde::Deserialize;

use crate::api::context::{ApiContext, AuthorizationService};

#[cfg(test)]
mod test;

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RecentMessagesQuery {
    /// 1 to 100; defaults to 50, and values outside the range are clamped.
    /// With `days`, 1 to 500.
    pub limit: Option<u16>,
    /// Snippet length, 1 to 500; defaults to the provider's 300. Longer
    /// snippets come from the body.
    pub snippet_chars: Option<u16>,
    /// Read the messages of the last `days` days (1 to 30) instead of the
    /// newest `limit`.
    pub days: Option<u16>,
    /// With `days`: `inbox` by default, or `sent`.
    pub folder: Option<RecentMailFolder>,
    /// With `days`: how many of the newest carry a snippet; defaults to all.
    pub texts: Option<u16>,
}

/// What a request asks to read.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Read {
    Newest { limit: u16, snippet_chars: u16 },
    Window(WindowRead),
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum RecentMessagesError {
    #[error("invalid user id")]
    InvalidUser,
    #[error("folder requires days")]
    FolderRequiresDays,
    #[error("the user's inboxes could not be read")]
    Inboxes(#[from] MailboxError),
}

impl IntoResponse for RecentMessagesError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::InvalidUser | Self::FolderRequiresDays => StatusCode::BAD_REQUEST,
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

/// The user and the read a request asks for.
fn parse_request(
    user_id: String,
    query: RecentMessagesQuery,
) -> Result<(MacroUserIdStr<'static>, Read), RecentMessagesError> {
    let user = MacroUserIdStr::try_from(user_id).map_err(|_| RecentMessagesError::InvalidUser)?;
    let limit = query.limit.unwrap_or(DEFAULT_RECENT_MESSAGES);
    let snippet_chars = query.snippet_chars.unwrap_or(DEFAULT_SNIPPET_CHARS);
    let read = match query.days {
        None if query.folder.is_some() => return Err(RecentMessagesError::FolderRequiresDays),
        None => Read::Newest {
            limit,
            snippet_chars,
        },
        Some(days) => Read::Window(WindowRead {
            folder: query.folder.unwrap_or_default(),
            days,
            limit,
            // Every message the read keeps: the domain clamps `limit`
            // (`limit=0` reads one) and caps `texts` at what it kept.
            texts: query.texts.unwrap_or(u16::MAX),
            snippet_chars,
        }),
    };
    Ok((user, read))
}

/// Up to `limit` of the newest messages across the user's own inboxes, newest
/// first, or with `days` the messages in the chosen folder. A mailbox whose
/// provider read fails is left out.
#[tracing::instrument(skip_all, err)]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(user_id): Path<String>,
    Query(query): Query<RecentMessagesQuery>,
) -> Result<Json<RecentInboxMessagesResponse>, RecentMessagesError> {
    let (user, read) = parse_request(user_id, query)?;
    let messages = match read {
        Read::Newest {
            limit,
            snippet_chars,
        } => ctx.recent_inbox.read(&user, limit, snippet_chars).await?,
        Read::Window(window) => {
            ctx.recent_inbox
                .read_window(&user, window, chrono::Utc::now())
                .await?
        }
    };

    Ok(Json(RecentInboxMessagesResponse { messages }))
}
