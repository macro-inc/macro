use crate::api::context::ApiContext;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use uuid::Uuid;

/// How a caller is allowed to act on an inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboxAccess {
    /// The caller owns the inbox (`link.macro_id == caller`).
    Own,
    /// The caller reaches the inbox through a `macro_user_links` edge.
    Delegated,
}

/// Resolves the link by id and authorizes the caller against it.
///
/// Returns the link together with how the caller may act on it. Maps to a 404
/// when the link does not exist and a 403 when the caller has neither ownership
/// nor a delegation edge.
pub async fn authorize_inbox_access(
    ctx: &ApiContext,
    caller_macro_id: &str,
    link_id: Uuid,
) -> Result<(Link, InboxAccess), Response> {
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, %link_id, "failed to fetch link");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to fetch inbox")
        })?
        .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "inbox not found"))?;

    if link.macro_id.as_ref() == caller_macro_id {
        return Ok((link, InboxAccess::Own));
    }

    let delegated = macro_db_client::macro_user_links::edge_exists(
        &ctx.db,
        caller_macro_id,
        link.macro_id.as_ref(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, %link_id, "failed to check delegation edge");
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to authorize inbox",
        )
    })?;

    if delegated {
        Ok((link, InboxAccess::Delegated))
    } else {
        Err(error_response(
            StatusCode::FORBIDDEN,
            "not authorized for this inbox",
        ))
    }
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(ErrorResponse {
            message: message.to_string().into(),
        }),
    )
        .into_response()
}
