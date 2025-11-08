use axum::{
    Extension,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
};

use model::response::{GenericErrorResponse, GenericResponse};
use sqlx::PgPool;

use crate::{
    api::context::ApiContext,
    model::{
        request::documents::get_user_documents::{
            GetUserDocumentsParams, GetUserDocumentsQueryParams,
        },
        response::documents::get::{GetDocumentsResponse, UserDocumentsResponse},
    },
};
use macro_db_client::document::get_user_documents;
use model::user::UserContext;

/// Gets the users documents to populate their recent document list
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents",
        params(
            ("limit" = i64, Query, description = "The maximum number of documents to retreive. Default 10, max 100."),
            ("offset" = i64, Query, description = "The offset to start from. Default 0."),
            ("file_type" = String, Query, description = "The file type to filter by. Default all."),
        ),
        responses(
            (status = 200, body=GetDocumentsResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context, params), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn get_user_documents_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Query(params): Query<GetUserDocumentsQueryParams>,
) -> impl IntoResponse {
    if let Some(limit) = params.limit
        && limit > 100
    {
        tracing::warn!(
            "exceeded max value for limit on user documents limit={}",
            limit
        );
        return GenericResponse::builder()
            .message("limit must be less than or equal to 100")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    let query_params = GetUserDocumentsParams::from_query_params(params);

    let documents = match get_user_documents(
        &db,
        user_context.user_id.as_str(),
        query_params.limit,
        query_params.offset,
        query_params.file_type,
    )
    .await
    {
        Ok(documents) => documents,
        Err(e) => {
            tracing::error!(error=?e, user_id=?user_context.user_id, "failed to get user documents");
            return GenericResponse::builder()
                .message("failed to get documents")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Only include the next offset if there are more documents to fetch
    let next_offset = if query_params.offset + query_params.limit < documents.1 {
        Some(query_params.offset + query_params.limit)
    } else {
        None
    };

    let response_data = UserDocumentsResponse {
        documents: documents.0,
        total: documents.1,
        next_offset,
    };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
