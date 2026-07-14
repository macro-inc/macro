use axum::{
    Json, Router,
    extract::{self, FromRef, State},
    routing::get,
};
use axum_extra::extract::Cached;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationServiceHandle};
use model_error_response::ErrorResponse;
use models_pagination::{
    CursorOptionExt, CursorWithValAndFilter, SimpleSortMethod, TypeEraseCursor,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    domain::{models::GetEmailsRequest, ports::EmailService},
    inbound::axum::{
        api_types::ApiPaginatedThreadCursor,
        axum_impls::{
            GetPreviewsCursorError, GetPreviewsCursorParams, MultiEmailLinkExtractor,
            PreviewViewPathExtractor,
        },
    },
};

pub struct EmailRouterState<T> {
    pub(crate) inner: Arc<T>,
    pub authorization: MacroAuthorizationServiceHandle,
}

impl<T> Clone for EmailRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            authorization: self.authorization.clone(),
        }
    }
}

impl<T> FromRef<EmailRouterState<T>> for MacroAuthorizationServiceHandle {
    fn from_ref(state: &EmailRouterState<T>) -> Self {
        state.authorization.clone()
    }
}

impl<T> EmailRouterState<T>
where
    T: EmailService,
{
    pub fn new(state: T, authorization: MacroAuthorizationServiceHandle) -> Self {
        Self {
            inner: Arc::new(state),
            authorization,
        }
    }

    /// Returns an `Arc` to the inner service.
    pub fn service(&self) -> Arc<T> {
        Arc::clone(&self.inner)
    }
}

pub fn router<S, T>(state: EmailRouterState<T>) -> Router<S>
where
    S: Send + Sync,
    T: EmailService,
{
    Router::new()
        .route("/cursor/{view}", get(cursor_handler))
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
#[tracing::instrument(skip(links, authorization, service), fields(user_id=authorization.macro_user_id.as_ref(), fusionauth_user_id=authorization.user_context.fusion_user_id))]
async fn cursor_handler<T: EmailService>(
    State(service): State<EmailRouterState<T>>,
    authorization: MacroAuthorizationExtractor,
    Cached(MultiEmailLinkExtractor(links, _)): Cached<MultiEmailLinkExtractor<T>>,
    PreviewViewPathExtractor(preview_view): PreviewViewPathExtractor,
    extract::Query(params): extract::Query<GetPreviewsCursorParams>,
    cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, ()>>,
) -> Result<Json<ApiPaginatedThreadCursor>, GetPreviewsCursorError> {
    Ok(Json(ApiPaginatedThreadCursor::new(
        service
            .inner
            .get_email_thread_previews(GetEmailsRequest {
                view: preview_view,
                link_ids: links.iter().map(|link| link.id).collect(),
                macro_id: authorization.macro_user_id,
                limit: params.limit,
                query: cursor
                    .into_query(
                        params
                            .sort_method
                            .map(|v| v.into_simple_sort())
                            .unwrap_or(SimpleSortMethod::ViewedUpdated),
                        (),
                    )
                    .map_filter(|_| None),
                team_receipt: None,
                crm_scope: None,
            })
            .await?
            .type_erase(),
    )))
}
