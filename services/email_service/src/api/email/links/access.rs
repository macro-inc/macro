use crate::api::context::ApiContext;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use thiserror::Error;
use uuid::Uuid;

/// How a caller is allowed to act on an inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboxAccess {
    /// The caller owns the inbox (`link.macro_id == caller`).
    Own,
    /// The caller reaches the inbox through a `macro_user_links` edge.
    Delegated,
}

/// Error shared by the per-inbox action handlers (delete, resync). Carries
/// `Display` so handlers can be instrumented with `err`.
#[derive(Debug, Error)]
pub enum InboxActionError {
    #[error("inbox not found")]
    NotFound,

    #[error("not authorized for this inbox")]
    Forbidden,

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for InboxActionError {
    fn into_response(self) -> Response {
        let status = match &self {
            InboxActionError::NotFound => StatusCode::NOT_FOUND,
            InboxActionError::Forbidden => StatusCode::FORBIDDEN,
            InboxActionError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            InboxActionError::Internal(_) => "internal error".to_string(),
            other => other.to_string(),
        };

        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Resolves the link by id and authorizes the caller against it.
///
/// Returns the link together with how the caller may act on it: [`InboxActionError::NotFound`]
/// when the link does not exist and [`InboxActionError::Forbidden`] when the caller
/// has neither ownership nor a delegation edge.
pub async fn authorize_inbox_access(
    ctx: &ApiContext,
    caller_macro_id: &str,
    link_id: Uuid,
) -> Result<(Link, InboxAccess), InboxActionError> {
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id)
        .await?
        .ok_or(InboxActionError::NotFound)?;

    if link.macro_id.as_ref() == caller_macro_id {
        return Ok((link, InboxAccess::Own));
    }

    let delegated = macro_db_client::macro_user_links::edge_exists(
        &ctx.db,
        caller_macro_id,
        link.macro_id.as_ref(),
        link.id,
    )
    .await?;

    if delegated {
        Ok((link, InboxAccess::Delegated))
    } else {
        Err(InboxActionError::Forbidden)
    }
}
