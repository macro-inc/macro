use crate::api::context::ApiContext;
use axum::{
    Extension,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use model::document::list::{DocumentListFilters, ListDocumentsWithAccessResponse};
use model::response::GenericErrorResponse;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::Deserialize;
use std::str::FromStr;
use utoipa::IntoParams;

const MAX_PAGE_SIZE: i64 = 1000;

fn default_page_size() -> i64 {
    50
}

#[derive(Debug, Deserialize, JsonSchema, IntoParams)]
#[schemars(rename_all = "camelCase")]
pub struct ListDocumentsWithAccessQuery {
    /// File types to filter by (comma-separated)
    pub file_types: Option<String>,
    /// Minimum access level required (view, comment, edit, owner)
    pub min_access_level: Option<String>,
    /// Page number for pagination (0-based)
    #[serde(default)]
    pub page: i64,
    /// Number of results per page (max 1000, default 50)
    #[serde(default = "default_page_size")]
    pub page_size: i64,
}

/// Lists documents the user has access to with optional filtering
#[utoipa::path(
    get,
    path = "/internal/documents/list_with_access",
    params(ListDocumentsWithAccessQuery),
    responses(
        (status = 200, body = ListDocumentsWithAccessResponse),
        (status = 400, body = GenericErrorResponse),
        (status = 500, body = GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn list_documents_with_access_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Query(query): Query<ListDocumentsWithAccessQuery>,
) -> impl IntoResponse {
    let page_size = if query.page_size <= 0 || query.page_size > MAX_PAGE_SIZE {
        return (
            StatusCode::BAD_REQUEST,
            format!("page_size must be between 1 and {MAX_PAGE_SIZE}"),
        )
            .into_response();
    } else {
        query.page_size
    };

    if query.page < 0 {
        return (
            StatusCode::BAD_REQUEST,
            "page must be non-negative".to_string(),
        )
            .into_response();
    }

    let offset = query.page * page_size;

    let file_types = query
        .file_types
        .map(|ft| ft.split(',').map(|s| s.trim().to_string()).collect());

    let filters = DocumentListFilters { file_types };

    let min_access_level = match query.min_access_level.as_deref() {
        Some(level_str) => match AccessLevel::from_str(level_str) {
            Ok(level) => level,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    "min_access_level must be one of: view, comment, edit, owner".to_string(),
                )
                    .into_response();
            }
        },
        None => AccessLevel::View,
    };

    let documents = match macro_db_client::document::list_documents_with_access(
        &ctx.db,
        &user_context.user_id,
        &filters,
        min_access_level,
        offset,
        page_size,
    )
    .await
    {
        Ok(documents) => documents,
        Err(e) => {
            tracing::error!(
                error=?e,
                user_id=?user_context.user_id,
                "unable to list documents with access"
            );
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to list documents with access".to_string(),
            )
                .into_response();
        }
    };

    let results_returned = documents.len();

    let response = ListDocumentsWithAccessResponse {
        documents,
        results_returned,
    };

    (StatusCode::OK, Json(response)).into_response()
}
