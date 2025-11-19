use crate::domain::{
    models::{
        Attachment, AttachmentMacro, Contact, EmailErr, EnrichedThreadPreviewCursor,
        GetEmailsRequest, PreviewView, ThreadPreviewCursor,
    },
    ports::EmailService,
};
use axum::{
    Extension, Json, RequestPartsExt, Router, async_trait,
    extract::{self, FromRequestParts, Path, State, rejection::PathRejection},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::get,
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{
    CursorExtractor, PaginatedOpaqueCursor, SimpleSortMethod, TypeEraseCursor,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use std::{str::FromStr, sync::Arc};
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

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

#[derive(Debug, Error)]
pub enum GetPreviewsCursorError {
    #[error(transparent)]
    PathErr(#[from] PathRejection),
    #[error("Invalid view parameter: {0}")]
    InvalidView(String),

    #[error("Internal server error")]
    DatabaseQueryError(#[from] EmailErr),
}

impl IntoResponse for GetPreviewsCursorError {
    fn into_response(self) -> Response {
        let msg = self.to_string();

        let status_code = match self {
            GetPreviewsCursorError::InvalidView(_) => StatusCode::BAD_REQUEST,
            GetPreviewsCursorError::DatabaseQueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            GetPreviewsCursorError::PathErr(path_rejection) => {
                return path_rejection.into_response();
            }
        };

        (status_code, msg).into_response()
    }
}

#[derive(Debug, Clone)]
pub struct LinkUuid(pub Uuid);

pub struct PreviewViewExtractor(PreviewView);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for PreviewViewExtractor {
    type Rejection = GetPreviewsCursorError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let Path(view) = parts.extract::<Path<String>>().await?;
        Ok(PreviewViewExtractor(
            PreviewView::from_str(&view).map_err(GetPreviewsCursorError::InvalidView)?,
        ))
    }
}

/// Parameters for getting thread previews with cursor-based pagination.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GetPreviewsCursorParams {
    /// Limit for pagination. Default is 20. Max is 500.
    pub limit: Option<u32>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_updated.
    pub sort_method: Option<ApiSortMethod>,
}

/// common types of sorts based on timestamps
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiSortMethod {
    /// we are sorting by the viewed_at time
    ViewedAt,
    /// we are sorting by the updated_at time
    UpdatedAt,
    /// we are sorting by the created_at time
    CreatedAt,
    /// we are sorting by the viewed/updated time
    ViewedUpdated,
}

impl ApiSortMethod {
    pub fn into_simple_sort(self) -> SimpleSortMethod {
        match self {
            ApiSortMethod::ViewedAt => SimpleSortMethod::ViewedAt,
            ApiSortMethod::UpdatedAt => SimpleSortMethod::UpdatedAt,
            ApiSortMethod::CreatedAt => SimpleSortMethod::CreatedAt,
            ApiSortMethod::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
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

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
struct ApiThreadPreviewCursor {
    #[serde(flatten)]
    thread: ApiThreadPreviewCursorInner,
    attachments: Vec<ApiAttachment>,
    macro_attachments: Vec<ApiAttachmentMacro>,
    contacts: Vec<ApiContact>,
    frecency_score: Option<f64>,
}

impl ApiThreadPreviewCursor {
    #[inline]
    fn new(model: EnrichedThreadPreviewCursor) -> Self {
        let EnrichedThreadPreviewCursor {
            thread,
            attachments,
            attachments_macro,
            frecency_score,
            participants,
        } = model;

        ApiThreadPreviewCursor {
            thread: ApiThreadPreviewCursorInner::new(thread),
            attachments: attachments.into_iter().map(ApiAttachment::new).collect(),
            macro_attachments: attachments_macro
                .into_iter()
                .map(ApiAttachmentMacro::new)
                .collect(),
            contacts: participants.into_iter().map(ApiContact::new).collect(),
            frecency_score,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiThreadPreviewCursorInner {
    id: Uuid,
    provider_id: Option<String>,
    owner_id: String,
    inbox_visible: bool,
    is_read: bool,
    is_draft: bool,
    is_important: bool,
    name: Option<String>,
    snippet: Option<String>,
    sender_email: Option<String>,
    sender_name: Option<String>,
    sender_photo_url: Option<String>,

    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    sort_ts: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    updated_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[schema(value_type = i64, nullable = true)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "Option<i64>"))]
    viewed_at: Option<DateTime<Utc>>,
}

impl ApiThreadPreviewCursorInner {
    #[inline]
    fn new(thread: ThreadPreviewCursor) -> Self {
        let ThreadPreviewCursor {
            id,
            provider_id,
            owner_id,
            inbox_visible,
            is_read,
            is_draft,
            is_important,
            name,
            snippet,
            sender_email,
            sender_name,
            sender_photo_url,
            sort_ts,
            created_at,
            updated_at,
            viewed_at,
        } = thread;

        Self {
            id,
            provider_id,
            owner_id: owner_id.to_string(),
            inbox_visible,
            is_read,
            is_draft,
            is_important,
            name,
            snippet,
            sender_email,
            sender_name,
            sender_photo_url,
            sort_ts,
            created_at,
            updated_at,
            viewed_at,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiAttachment {
    id: Uuid,
    message_id: Uuid,
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    provider_attachment_id: Option<String>,
    filename: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    content_id: Option<String>,

    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    #[cfg_attr(feature = "ai_schema", schemars(with = "i64"))]
    created_at: DateTime<Utc>,
}

impl ApiAttachment {
    #[inline]
    fn new(model: Attachment) -> Self {
        let Attachment {
            id,
            thread_id: _,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
        } = model;

        ApiAttachment {
            id,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiAttachmentMacro {
    db_id: Uuid,
    message_id: Uuid,
    item_id: Uuid,
    item_type: String,
}

impl ApiAttachmentMacro {
    #[inline]
    fn new(model: AttachmentMacro) -> Self {
        let AttachmentMacro {
            thread_id: _,
            db_id,
            message_id,
            item_id,
            item_type,
        } = model;
        ApiAttachmentMacro {
            db_id,
            message_id,
            item_id,
            item_type,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ApiContact {
    id: Uuid,
    link_id: Uuid,
    name: Option<String>,
    email_address: Option<String>,
    sfs_photo_url: Option<String>,
}

impl ApiContact {
    #[inline]
    fn new(model: Contact) -> Self {
        let Contact {
            id,
            thread_id: _,
            link_id,
            name,
            email_address,
            sfs_photo_url,
        } = model;

        ApiContact {
            id,
            link_id,
            name,
            email_address,
            sfs_photo_url,
        }
    }
}

#[derive(Debug, ToSchema, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiPaginatedThreadCursor {
    items: Vec<ApiThreadPreviewCursor>,
    next_cursor: Option<String>,
}

impl ApiPaginatedThreadCursor {
    #[inline]
    fn new(model: PaginatedOpaqueCursor<EnrichedThreadPreviewCursor>) -> Self {
        let PaginatedOpaqueCursor {
            items, next_cursor, ..
        } = model;
        ApiPaginatedThreadCursor {
            items: items.into_iter().map(ApiThreadPreviewCursor::new).collect(),
            next_cursor,
        }
    }
}
