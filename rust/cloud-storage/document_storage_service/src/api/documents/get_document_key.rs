use std::str::FromStr;

use crate::model::response::documents::get::{GetDocumentKeyResponse, GetDocumentKeyResponseData};
use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::document::{
    CONVERTED_DOCUMENT_FILE_NAME, FileType, build_cloud_storage_bucket_document_key,
};
use model::response::GenericErrorResponse;
use model::{document::DocumentBasic, response::GenericResponse, user::UserContext};
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
    pub document_version_id: i64,
}

/// Gets the current documents share permissions
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/{document_version_id}/key",
        params(
            ("document_id" = String, Path, description = "Document ID"),
            ("document_version_id" = i64, Path, description = "Document Version ID")
        ),
        responses(
            (status = 200, body=GetDocumentKeyResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context, document_context, _access), fields(user_id=?user_context.user_id, file_type=?document_context.file_type))]
pub async fn get_document_key_handler(
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params {
        document_id,
        document_version_id,
    }): Path<Params>,
) -> impl IntoResponse {
    let file_type: FileType = if let Some(file_type) = &document_context.file_type {
        match FileType::from_str(file_type.as_str()) {
            Ok(file_type) => file_type,
            Err(e) => {
                tracing::error!(error=?e, "invalid file type");
                return GenericResponse::builder()
                    .message("invalid file type")
                    .is_error(true)
                    .send(StatusCode::BAD_REQUEST);
            }
        }
    } else {
        return GenericResponse::builder()
            .message("no file type")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    };

    let key = match file_type {
        FileType::Pdf => {
            let document_version_id =
                match macro_db_client::document::get_document_version_id(&db, &document_id).await {
                    Ok(document_version_id) => document_version_id.0,
                    Err(e) => {
                        tracing::error!(error=?e, "unable to get document version id");
                        return GenericResponse::builder()
                            .message("unable to get document version id")
                            .is_error(true)
                            .send(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                };

            build_cloud_storage_bucket_document_key(
                &document_context.owner,
                &document_id,
                document_version_id,
                Some(file_type.as_str()),
            )
        }
        FileType::Docx => {
            format!(
                "{}/{}/{}.pdf",
                document_context.owner, document_id, CONVERTED_DOCUMENT_FILE_NAME
            )
        }
        _ => {
            tracing::error!("invalid file type");
            return GenericResponse::builder()
                .message(format!("Invalid file type {}", file_type.as_str()).as_str())
                .is_error(true)
                .send(StatusCode::BAD_REQUEST);
        }
    };

    GenericResponse::builder()
        .data(&GetDocumentKeyResponseData { key })
        .send(StatusCode::OK)
}
