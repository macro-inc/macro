use axum::{
    Extension, Json, Router,
    extract::{self, State},
    routing::get,
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{CursorExtractor, SimpleSortMethod, TypeEraseCursor};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    domain::{models::GetEmailsRequest, ports::EmailService},
    inbound::{
        ApiPaginatedThreadCursor,
        axum::axum_impls::{
            GetPreviewsCursorError, GetPreviewsCursorParams, LinkUuid, PreviewViewExtractor,
        },
    },
};

pub struct EmailPreviewState<T> {
    inner: Arc<T>,
}

impl<T> Clone for EmailPreviewState<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<T> EmailPreviewState<T>
where
    T: EmailService,
{
    pub fn new(state: T) -> Self {
        Self {
            inner: Arc::new(state),
        }
    }
}

pub fn router<S, T>(state: EmailPreviewState<T>) -> Router<S>
where
    S: Send + Sync,
    T: EmailService,
{
    Router::new()
        .route("/cursor/:view", get(cursor_handler))
        .with_state(state)
}

/// Get paginated thread previews with cursor-based pagination.
#[utoipa::path(
    get,
    tag = "Previews",
    path = "/email/threads/previews/cursor/{view}",
    operation_id = "previews_inbox_cursor",
    params(
        GetPreviewsCursorParams,
        ("view" = String, Path, description = "View type. Supported values: inbox, sent, drafts, starred, all, important, other, user:<label>"),
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id, separated by |."),
    ),
    responses(
            (status = 200, body=ApiPaginatedThreadCursor),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(link_id, macro_user, service), fields(user_id=macro_user.macro_user_id.as_ref(), fusionauth_user_id=macro_user.user_context.fusion_user_id))]
async fn cursor_handler<T: EmailService>(
    State(service): State<EmailPreviewState<T>>,
    macro_user: MacroUserExtractor,
    Extension(LinkUuid(link_id)): Extension<LinkUuid>,
    PreviewViewExtractor(preview_view): PreviewViewExtractor,
    extract::Query(params): extract::Query<GetPreviewsCursorParams>,
    cursor: CursorExtractor<Uuid, SimpleSortMethod, ()>,
) -> Result<Json<ApiPaginatedThreadCursor>, GetPreviewsCursorError> {
    Ok(Json(ApiPaginatedThreadCursor::new(
        service
            .inner
            .get_emails(GetEmailsRequest {
                view: preview_view,
                link_id,
                macro_id: macro_user.macro_user_id,
                limit: params.limit,
                query: cursor.into_query(
                    params
                        .sort_method
                        .map(|v| v.into_simple_sort())
                        .unwrap_or(SimpleSortMethod::ViewedUpdated),
                    (),
                ),
            })
            .await?
            .type_erase(),
    )))
}
