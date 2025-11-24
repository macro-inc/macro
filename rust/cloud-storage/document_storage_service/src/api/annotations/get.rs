use std::str::FromStr;

use crate::{
    api::context::ApiContext,
    model::response::annotations::{AnchorResponse, ThreadResponse},
};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::annotations::get::{get_document_comments, get_pdf_anchors};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{
    annotations::Anchor,
    document::{DocumentBasic, FileType},
    response::ErrorResponse,
};
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;

use super::comment_error_response;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets a set of comment threads for a document
#[utoipa::path(
        get,
        path = "/annotations/comments/document/{document_id}",
        operation_id = "get_document_comments",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=ThreadResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler(state = ApiContext)]
#[tracing::instrument(skip(_access, db))]
pub async fn get_document_comments_handler(
    Path(Params { document_id }): Path<Params>,
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
) -> Result<Response, Response> {
    match get_document_comments(&db, &document_id).await {
        Ok(threads) => Ok((StatusCode::OK, Json(ThreadResponse { data: threads })).into_response()),
        Err(e) => comment_error_response(e, "Error retrieving comments"),
    }
}

/// Gets a set of comment anchors for a document
#[utoipa::path(
        get,
        path = "/annotations/anchors/document/{document_id}",
        operation_id = "get_document_anchors",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=AnchorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(_access, db))]
pub async fn get_document_anchors_handler(
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    Path(Params { document_id }): Path<Params>,
    State(db): State<PgPool>,
    document_context: Extension<DocumentBasic>,
) -> Result<Response, Response> {
    match document_context
        .file_type
        .as_deref()
        .and_then(|f| FileType::from_str(f).ok())
    {
        Some(FileType::Pdf | FileType::Docx) => match get_pdf_anchors(&db, &document_id).await {
            Ok(pdf_anchors) => {
                let anchors: Vec<Anchor> = pdf_anchors.into_iter().map(Anchor::Pdf).collect();
                Ok((StatusCode::OK, Json(AnchorResponse { data: anchors })).into_response())
            }
            Err(e) => comment_error_response(e, "Error retrieving anchors"),
        },
        _ => Err((
            StatusCode::METHOD_NOT_ALLOWED,
            Json(ErrorResponse {
                message: "Unsupported file type",
            }),
        )
            .into_response()),
    }
}
