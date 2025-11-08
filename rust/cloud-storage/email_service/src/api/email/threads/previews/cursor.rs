use crate::api::context::ApiContext;
use crate::api::email::threads::previews::GetPreviewsPaginationCursorParams;
use axum::extract::rejection::PathRejection;
use axum::extract::{FromRequestParts, Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json, RequestPartsExt, async_trait, extract};
use email_db_client::attachments::marco::get_macro_attachments_by_thread_ids;
use email_db_client::attachments::provider::get_attachments_by_thread_ids;
use email_db_client::contacts::get::get_contacts_by_thread_ids;
use email_db_client::previews::cursor::fetch_previews_for_view_cursor;
use frecency::domain::ports::AggregateFrecencyStorage;
use futures::join;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model::user::UserContext;
use model_entity::EntityType;
use models_email::email::service::thread::{
    GetPreviewsCursorParams, PreviewCursorQuery, PreviewView,
};
use models_email::service::link::Link;
use models_email::service::thread::ThreadPreviewCursor;
use models_pagination::{
    CursorExtractor, CursorVal, Identify, PaginateOn, Paginated, SimpleSortMethod, SortOn,
};
use schemars::JsonSchema;
use serde::Serialize;
use std::collections::HashMap;
use std::str::FromStr;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum GetPreviewsCursorError {
    #[error(transparent)]
    PathErr(#[from] PathRejection),
    #[error("Invalid view parameter: {0}")]
    InvalidView(String),

    #[error("Internal server error")]
    DatabaseQueryError(String, anyhow::Error),

    #[error("Internal server error")]
    Frecency(#[from] sqlx::Error),

    #[error("Invalid user id")]
    Id(#[from] macro_user_id::user_id::ParseErr),
}

impl IntoResponse for GetPreviewsCursorError {
    fn into_response(self) -> Response {
        let msg = self.to_string();

        let status_code = match self {
            GetPreviewsCursorError::InvalidView(_) => StatusCode::BAD_REQUEST,
            GetPreviewsCursorError::DatabaseQueryError(_, _)
            | GetPreviewsCursorError::Frecency(_)
            | GetPreviewsCursorError::Id(_) => StatusCode::INTERNAL_SERVER_ERROR,
            GetPreviewsCursorError::PathErr(path_rejection) => {
                return path_rejection.into_response();
            }
        };

        (status_code, msg).into_response()
    }
}

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

#[derive(Debug, Serialize, JsonSchema, ToSchema)]
pub struct ThreadPreviewFrecency {
    #[serde(flatten)]
    preview: ThreadPreviewCursor,
    frecency_score: f64,
}

impl Identify for ThreadPreviewFrecency {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.preview.id()
    }
}

impl SortOn<SimpleSortMethod> for ThreadPreviewFrecency {
    fn sort_on(sort: SimpleSortMethod) -> impl FnOnce(&Self) -> CursorVal<SimpleSortMethod> {
        let cb = ThreadPreviewCursor::sort_on(sort);
        move |v| cb(&v.preview)
    }
}

#[derive(Debug, Serialize, JsonSchema, ToSchema)]
pub struct ThreadPreviewPagination {
    items: Vec<ThreadPreviewFrecency>,
    next_cursor: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema)]
pub struct GetPreviewsFrecencyResponse {
    /// the thread, with messages inside
    pub previews: ThreadPreviewPagination,
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
            (status = 200, body=GetPreviewsFrecencyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn previews_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    PreviewViewExtractor(preview_view): PreviewViewExtractor,
    extract::Query(params): extract::Query<GetPreviewsCursorParams>,
    cursor: CursorExtractor<Uuid, SimpleSortMethod>,
) -> Result<Json<GetPreviewsFrecencyResponse>, GetPreviewsCursorError> {
    let params = GetPreviewsPaginationCursorParams::new_from_params(params);

    let query = PreviewCursorQuery {
        view: preview_view,
        link_id: link.id,
        limit: params.limit,
        query: cursor.into_query(params.sort_method),
    };
    let sort_method = *query.query.sort_method();

    let previews = fetch_previews_for_view_cursor(&ctx.db, query, &link.macro_id)
        .await
        .map_err(|e| GetPreviewsCursorError::DatabaseQueryError("fetch_previews".to_string(), e))?;

    let thread_ids: Vec<Uuid> = previews.iter().map(|p| p.id).collect();

    let (attachment_map_result, macro_attachment_map_result, participant_result, frecency_scores) = join!(
        get_attachments_by_thread_ids(&ctx.db, &thread_ids),
        get_macro_attachments_by_thread_ids(&ctx.db, &thread_ids),
        get_contacts_by_thread_ids(&ctx.db, &thread_ids),
        ctx.frecency_storage.get_aggregate_for_user_entities(
            MacroUserIdStr::parse_from_str(&link.macro_id)?.into_owned(),
            thread_ids
                .iter()
                .map(|id| EntityType::Email.with_entity_string(id.to_string()))
        )
    );

    let mut attachment_map = attachment_map_result.map_err(|e| {
        GetPreviewsCursorError::DatabaseQueryError("fetch_attachments".to_string(), e)
    })?;

    let mut macro_attachment_map = macro_attachment_map_result.map_err(|e| {
        GetPreviewsCursorError::DatabaseQueryError("fetch_macro_attachments".to_string(), e)
    })?;

    let mut participant_map = participant_result.map_err(|e| {
        GetPreviewsCursorError::DatabaseQueryError("fetch_participants".to_string(), e)
    })?;

    let frecency_scores_map: HashMap<Uuid, f64> = frecency_scores
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            Some((
                Uuid::from_str(&v.id.entity.entity_id).ok()?,
                v.data.frecency_score,
            ))
        })
        .collect();

    let Paginated {
        items, next_cursor, ..
    } = previews
        .into_iter()
        .map(|mut item| {
            item.attachments = attachment_map.remove(&item.id).unwrap_or_default();
            item.attachments_macro = macro_attachment_map.remove(&item.id).unwrap_or_default();
            item.participants = participant_map.remove(&item.id).unwrap_or_default();
            let frecency_score = frecency_scores_map
                .get(&item.id)
                .copied()
                .unwrap_or_default();

            ThreadPreviewFrecency {
                preview: item,
                frecency_score,
            }
        })
        .paginate_on(params.limit as usize, sort_method)
        .into_page()
        .type_erase();

    Ok(Json(GetPreviewsFrecencyResponse {
        previews: ThreadPreviewPagination { items, next_cursor },
    }))
}
