use std::str::FromStr;

use crate::{
    api::{context::ApiContext, documents::utils},
    model::{
        request::documents::save::SaveDocumentRequest,
        response::documents::save::{SaveDocumentResponse, SaveDocumentResponseData},
    },
};
use axum::{
    Extension,
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::cloud_storage::ensure_access::{
    document::DocumentAccessExtractor, project::ProjectBodyAccessLevelExtractor,
};
use model::document::response::DocumentResponseMetadata;
use model::{
    document::{DocumentBasic, FileType, FileTypeExt, build_cloud_storage_bucket_document_key},
    response::{ErrorResponse, GenericErrorResponse, GenericResponse},
    user::UserContext,
};
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::save::save_document;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Creates a new version of a document
#[utoipa::path(
        tag = "document",
        put,
        path = "/documents/{document_id}",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        request_body = SaveDocumentRequest,
        responses(
            (status = 200, body=SaveDocumentResponse),
            (status = 304, body=GenericErrorResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, document_context, _access), fields(user_id=?user_context.user_id))]
pub async fn save_document_handler(
    _access: DocumentAccessExtractor<EditAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, SaveDocumentRequest>,
) -> impl IntoResponse {
    let req = project.into_inner();

    if document_context.deleted_at.is_some() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot modify deleted document",
            }),
        )
            .into_response();
    }

    // Ensure we have a valid file type
    let file_type: FileType = match document_context
        .file_type
        .as_deref()
        .and_then(|f| FileType::from_str(f).ok())
    {
        Some(file_type) => file_type,
        None => {
            tracing::error!("invalid file type");
            return GenericResponse::builder()
                .message("invalid file type")
                .is_error(true)
                .send(StatusCode::BAD_REQUEST);
        }
    };

    if file_type.is_image() {
        tracing::error!(file_type=?file_type, "cannot simple save image file");
        return GenericResponse::builder()
            .message("cannot simple save image file")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    // Prevalidation for saving documents
    match file_type {
        FileType::Docx => {
            // Since docx are now converted to pdf, there is never a need to save the docx file
            return GenericResponse::builder()
                .message("no bom parts to save")
                .is_error(false)
                .send(StatusCode::NOT_MODIFIED);
        }
        FileType::Pdf => {
            tracing::trace!("pre-validation for static file");
            if req.modification_data.is_none() {
                tracing::error!("requested to save file no modification data");
                return GenericResponse::builder()
                    .message("modificationData is required")
                    .is_error(true)
                    .send(StatusCode::BAD_REQUEST);
            }
        } // Static files require modification data to be present
        _ => {
            tracing::trace!("pre-validation for editable file");
            // The sha must be provided to save a standard editable file
            if req.sha.is_none() {
                tracing::error!("requested to save file no sha");
                return GenericResponse::builder()
                    .message("sha is required")
                    .is_error(true)
                    .send(StatusCode::BAD_REQUEST);
            }
        } // Standard editable files do not require modification data to be present but do require
          // a sha
    }

    let sha = req.sha.clone();

    let document_metadata: DocumentResponseMetadata = match save_document(
        &ctx.db,
        &ctx.redis_client,
        &ctx.s3_client,
        &document_id,
        file_type,
        &document_context,
        req,
    )
    .await
    {
        Ok(document_metadata) => document_metadata,
        Err((status_code, message, cleanup)) => {
            tracing::error!(error=%message, "unable to save document");
            if let Some((document_id, document_version_id)) = cleanup {
                utils::cleanup_document_version_on_error(
                    &ctx.db,
                    document_id.as_str(),
                    document_version_id,
                    file_type.as_str(),
                )
                .await;
            }
            return GenericResponse::builder()
                .message(message.as_str())
                .is_error(true)
                .send(status_code);
        }
    };

    // If the document is a monaco file, we will need to generate a presigned url to save the file
    let presigned_url: Option<String> = if file_type == FileType::Py || file_type == FileType::Js {
        let key = build_cloud_storage_bucket_document_key(
            &document_metadata.owner,
            &document_metadata.document_id,
            document_metadata.document_version_id,
            Some(file_type.as_str()),
        );
        // We've already validated that the sha is present for monaco files
        let sha = sha.unwrap();
        match ctx
            .s3_client
            .put_document_storage_presigned_url(&key, &sha, file_type.into())
            .await
        {
            Ok(presigned_url) => Some(presigned_url),
            Err(e) => {
                tracing::error!(error=?e, "unable to generate presigned url");
                // Cleanup document version on error
                utils::cleanup_document_version_on_error(
                    &ctx.db,
                    &document_metadata.document_id,
                    document_metadata.document_version_id,
                    file_type.as_str(),
                )
                .await;
                return GenericResponse::builder()
                    .message("unable to save document")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        None
    };

    GenericResponse::builder()
        .data(&SaveDocumentResponseData {
            document_metadata,
            presigned_url,
        })
        .send(StatusCode::OK)
}
