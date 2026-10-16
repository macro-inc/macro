use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::post};
use axum_extra::extract::Cached;
use chrono::{DateTime, Utc};
use item_filters::ast::{LiteralTree, email::EmailLiteral};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    models::{
        BulkThreadAction, BulkThreadActionResult, BulkThreadCursor, BulkThreadQuery,
        BulkThreadStart, BulkThreadTarget, BulkThreadTargetsPage, BulkThreadTargetsRequest,
        EmailErr, MAX_BULK_THREAD_ACTION_BATCH, MAX_BULK_THREAD_TARGETS_PAGE, PreviewView,
    },
    ports::EmailBulkThreadService,
};

use super::previews_router::EmailRouterState;

#[cfg(test)]
mod test;

/// A thread's position in a Mail view's order, echoed back to continue a listing.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiBulkThreadCursor {
    pub thread_id: Uuid,
    pub sort_ts: DateTime<Utc>,
}

impl From<BulkThreadCursor> for ApiBulkThreadCursor {
    fn from(cursor: BulkThreadCursor) -> Self {
        Self {
            thread_id: cursor.thread_id,
            sort_ts: cursor.sort_ts,
        }
    }
}

impl From<ApiBulkThreadCursor> for BulkThreadCursor {
    fn from(cursor: ApiBulkThreadCursor) -> Self {
        Self {
            thread_id: cursor.thread_id,
            sort_ts: cursor.sort_ts,
        }
    }
}

/// Request body for listing one page of a Mail view's threads.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBulkThreadTargetsRequest {
    /// The view's email filter tree, exactly as its list sends it to `/items/soup/ast`.
    #[serde(default, rename = "ef")]
    #[schema(value_type = serde_json::Value)]
    pub email_filter: LiteralTree<EmailLiteral>,
    /// The view's mailbox slice, exactly as its list sends it to `/items/soup/ast`.
    #[schema(value_type = String)]
    pub email_view: PreviewView,
    /// Start at this thread, inclusive ("select all below"). It must still
    /// match the view. Omit, with `cursor`, to start at the top.
    #[serde(default)]
    pub from_thread_id: Option<Uuid>,
    /// The previous page's `nextCursor`.
    #[serde(default)]
    pub cursor: Option<ApiBulkThreadCursor>,
    /// Threads per page, at most 500. Defaults to 500.
    #[serde(default)]
    pub limit: Option<u32>,
}

impl TryFrom<ListBulkThreadTargetsRequest> for BulkThreadTargetsRequest {
    type Error = BulkThreadsError;

    fn try_from(body: ListBulkThreadTargetsRequest) -> Result<Self, Self::Error> {
        let ListBulkThreadTargetsRequest {
            email_filter,
            email_view,
            from_thread_id,
            cursor,
            limit,
        } = body;
        let start = match (from_thread_id, cursor) {
            (Some(_), Some(_)) => {
                return Err(BulkThreadsError::Validation(
                    "Send either fromThreadId or cursor, not both".to_string(),
                ));
            }
            (Some(thread_id), None) => BulkThreadStart::FromThread(thread_id),
            (None, Some(cursor)) => BulkThreadStart::After(cursor.into()),
            (None, None) => BulkThreadStart::Top,
        };
        Ok(Self {
            query: BulkThreadQuery {
                view: email_view,
                filter: email_filter,
            },
            start,
            limit: limit.unwrap_or(MAX_BULK_THREAD_TARGETS_PAGE),
        })
    }
}

/// A thread a bulk action may change.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiBulkThreadTarget {
    pub id: Uuid,
    /// Mail Done: the thread is out of the inbox.
    pub done: bool,
    pub read: bool,
    /// The thread's position in the view; it moves when new mail arrives.
    pub sort_ts: DateTime<Utc>,
}

impl From<BulkThreadTarget> for ApiBulkThreadTarget {
    fn from(target: BulkThreadTarget) -> Self {
        Self {
            id: target.id,
            done: target.done,
            read: target.read,
            sort_ts: target.sort_ts,
        }
    }
}

/// One page of a Mail view's threads, in the list's order.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBulkThreadTargetsResponse {
    pub threads: Vec<ApiBulkThreadTarget>,
    /// Absent on the last page.
    pub next_cursor: Option<ApiBulkThreadCursor>,
}

impl From<BulkThreadTargetsPage> for ListBulkThreadTargetsResponse {
    fn from(page: BulkThreadTargetsPage) -> Self {
        Self {
            threads: page.threads.into_iter().map(Into::into).collect(),
            next_cursor: page.next.map(Into::into),
        }
    }
}

/// An action applied to every thread in a bulk request.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiBulkThreadAction {
    /// Mail Done.
    Archive,
    /// Mark Not Done.
    Unarchive,
    MarkRead,
    MarkUnread,
}

impl From<ApiBulkThreadAction> for BulkThreadAction {
    fn from(action: ApiBulkThreadAction) -> Self {
        match action {
            ApiBulkThreadAction::Archive => Self::Archive,
            ApiBulkThreadAction::Unarchive => Self::Unarchive,
            ApiBulkThreadAction::MarkRead => Self::MarkRead,
            ApiBulkThreadAction::MarkUnread => Self::MarkUnread,
        }
    }
}

/// Request body for applying one action to a batch of threads.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBulkThreadActionRequest {
    /// Between 1 and 100 threads.
    pub thread_ids: Vec<Uuid>,
    pub action: ApiBulkThreadAction,
}

/// A validated batch for one bulk action request.
#[derive(Debug, PartialEq, Eq)]
struct BulkThreadActionBatch {
    thread_ids: Vec<Uuid>,
    action: BulkThreadAction,
}

impl TryFrom<ApplyBulkThreadActionRequest> for BulkThreadActionBatch {
    type Error = BulkThreadsError;

    fn try_from(body: ApplyBulkThreadActionRequest) -> Result<Self, Self::Error> {
        if body.thread_ids.is_empty() || body.thread_ids.len() > MAX_BULK_THREAD_ACTION_BATCH {
            return Err(BulkThreadsError::Validation(format!(
                "Send between 1 and {MAX_BULK_THREAD_ACTION_BATCH} thread IDs"
            )));
        }
        Ok(Self {
            thread_ids: body.thread_ids,
            action: body.action.into(),
        })
    }
}

/// Per-thread outcome of a bulk action, in request order.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBulkThreadActionResponse {
    pub succeeded_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
}

impl From<BulkThreadActionResult> for ApplyBulkThreadActionResponse {
    fn from(result: BulkThreadActionResult) -> Self {
        Self {
            succeeded_ids: result.succeeded_ids,
            failed_ids: result.failed_ids,
        }
    }
}

/// Errors from the bulk thread handlers.
#[derive(Debug, Error)]
pub enum BulkThreadsError {
    /// The request is malformed.
    #[error("{0}")]
    Validation(String),
    /// The anchor thread is no longer in the view.
    #[error("Thread not found in this view")]
    ThreadNotFound,
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl From<EmailErr> for BulkThreadsError {
    fn from(err: EmailErr) -> Self {
        match err {
            EmailErr::ThreadNotFound => BulkThreadsError::ThreadNotFound,
            err => BulkThreadsError::Internal(err),
        }
    }
}

impl IntoResponse for BulkThreadsError {
    fn into_response(self) -> axum::response::Response {
        if let BulkThreadsError::Internal(error) = &self {
            tracing::error!(error = ?error, "bulk thread request failed");
        }
        let status = match &self {
            BulkThreadsError::Validation(_) => StatusCode::BAD_REQUEST,
            BulkThreadsError::ThreadNotFound => StatusCode::NOT_FOUND,
            BulkThreadsError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
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

/// Create the bulk thread router: `POST /bulk/targets` and `POST /bulk`.
pub fn bulk_threads_router<S, T, Auth>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailBulkThreadService,
    Auth: MacroAuthorizationService,
    EmailRouterState<T>: axum::extract::FromRef<S>,
    MacroAuthorizationState<Auth>: axum::extract::FromRef<S>,
{
    Router::new()
        .route(
            "/bulk/targets",
            post(list_bulk_thread_targets_handler::<T, Auth>),
        )
        .route("/bulk", post(apply_bulk_thread_action_handler::<T, Auth>))
}

/// List one page of the caller's threads matching a Mail view's query, so a
/// selection can include threads the client has not loaded.
#[utoipa::path(
    post,
    tag = "Threads",
    path = "/email/threads/bulk/targets",
    operation_id = "list_bulk_thread_targets",
    request_body = ListBulkThreadTargetsRequest,
    responses(
        (status = 200, body = ListBulkThreadTargetsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, description = "`fromThreadId` is no longer in the view", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_bulk_thread_targets_handler<T, Auth>(
    State(state): State<EmailRouterState<T>>,
    Cached(macro_user): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Json(body): Json<ListBulkThreadTargetsRequest>,
) -> Result<Json<ListBulkThreadTargetsResponse>, BulkThreadsError>
where
    T: EmailBulkThreadService,
    Auth: MacroAuthorizationService,
{
    let page = state
        .inner
        .list_bulk_thread_targets(
            macro_user.authorization.user.macro_user_id.clone(),
            body.try_into()?,
        )
        .await?;
    Ok(Json(page.into()))
}

/// Apply one action to each of the caller's threads. Idempotent: a repeated
/// request leaves threads as they are, and one failing thread never fails
/// the others.
#[utoipa::path(
    post,
    tag = "Threads",
    path = "/email/threads/bulk",
    operation_id = "apply_bulk_thread_action",
    request_body = ApplyBulkThreadActionRequest,
    responses(
        (status = 200, body = ApplyBulkThreadActionResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn apply_bulk_thread_action_handler<T, Auth>(
    State(state): State<EmailRouterState<T>>,
    Cached(macro_user): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Json(body): Json<ApplyBulkThreadActionRequest>,
) -> Result<Json<ApplyBulkThreadActionResponse>, BulkThreadsError>
where
    T: EmailBulkThreadService,
    Auth: MacroAuthorizationService,
{
    let BulkThreadActionBatch { thread_ids, action } = body.try_into()?;
    let result = state
        .inner
        .apply_bulk_thread_action(
            macro_user.authorization.user.macro_user_id.clone(),
            thread_ids,
            action,
        )
        .await;
    Ok(Json(result.into()))
}
