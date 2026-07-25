use axum::{
    Json, Router,
    extract::{self, State},
    routing::get,
};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
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
}

impl<T> Clone for EmailRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<T> EmailRouterState<T>
where
    T: EmailService,
{
    pub fn new(state: T) -> Self {
        Self {
            inner: Arc::new(state),
        }
    }

    /// Returns an `Arc` to the inner service.
    pub fn service(&self) -> Arc<T> {
        Arc::clone(&self.inner)
    }
}

pub fn router<S, T, Auth>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
    Auth: MacroAuthorizationService,
    EmailRouterState<T>: axum::extract::FromRef<S>,
    MacroAuthorizationState<Auth>: axum::extract::FromRef<S>,
{
    Router::new().route("/cursor/{view}", get(cursor_handler::<T, Auth>))
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
#[tracing::instrument(
    skip(links, macro_user, service),
    fields(
        actor = %macro_user.acting_entity(),
        fusionauth_user_id = tracing::field::Empty,
    )
)]
async fn cursor_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(service): State<EmailRouterState<T>>,
    Cached(macro_user): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Cached(MultiEmailLinkExtractor(links, _)): Cached<MultiEmailLinkExtractor<T, Auth>>,
    PreviewViewPathExtractor(preview_view): PreviewViewPathExtractor,
    extract::Query(params): extract::Query<GetPreviewsCursorParams>,
    cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, ()>>,
) -> Result<Json<ApiPaginatedThreadCursor>, GetPreviewsCursorError> {
    let user = &macro_user.authorization.user;
    let span = tracing::Span::current();
    span.record(
        "fusionauth_user_id",
        tracing::field::display(&user.user_context.fusion_user_id),
    );

    Ok(Json(ApiPaginatedThreadCursor::new(
        service
            .inner
            .get_email_thread_previews(GetEmailsRequest {
                view: preview_view,
                link_ids: links.iter().map(|link| link.id).collect(),
                macro_id: user.macro_user_id.clone(),
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
                include_frecency: true,
                team_receipt: None,
                crm_scope: None,
            })
            .await?
            .type_erase(),
    )))
}
