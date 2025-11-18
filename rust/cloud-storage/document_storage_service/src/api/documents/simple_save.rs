use std::str::FromStr;

use crate::{
    api::{context::ApiContext, documents::utils},
    model::response::documents::save::{SaveDocumentResponse, SaveDocumentResponseData},
};
use anyhow::Context;
use axum::{
    Extension,
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::document::response::DocumentResponseMetadata;
use model::{
    document::{DocumentBasic, FileType, FileTypeExt, build_cloud_storage_bucket_document_key},
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};
use models_permissions::share_permission::access_level::EditAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// For any file that isn't PDF or DOCX, use this endpoint for saving.
/// This endpoint will allow you to save the document by providing the file content as part of a multipart request. Use key 'file' along with the file bytes.
/// simple_save is different than the save_document endpoint because it does not return a presigned URL, Instead, it simply saves the file to S3 directly (and returns the document metadata).
#[utoipa::path(
        tag = "document",
        put,
        path = "/documents/{document_id}/simple_save",
        operation_id = "simple_save",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=SaveDocumentResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(_access, state, user_context, document_context, multipart), fields(user_id=?user_context.user_id))]
pub async fn handler(
    _access: DocumentAccessExtractor<EditAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let file_type: FileType = match document_context
        .file_type
        .as_deref()
        .and_then(|f| FileType::from_str(f).ok())
    {
        Some(f) => f,
        None => {
            tracing::error!(file_type=?document_context.file_type, "unable to convert file type");
            return GenericResponse::builder()
                .message("cannot simple save file without file type")
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

    match file_type {
        FileType::Docx | FileType::Pdf => {
            tracing::error!(file_type=?file_type, "cannot simple save file of this type");
        }
        _ => {}
    }

    let file_content = match get_file_content(&mut multipart).await {
        Ok(file_content) => file_content,
        Err(err) => {
            tracing::error!(error=?err, "unable to get file content");
            return GenericResponse::builder()
                .message("unable to get file content")
                .is_error(true)
                .send(StatusCode::BAD_REQUEST);
        }
    };

    let document = match macro_db_client::document::save_document(
        &state.db,
        &document_id,
        file_type,
        Some(""), // sha
        None,
        None,
    )
    .await
    {
        Ok(document) => document,
        Err(err) => {
            tracing::error!(error=?err, "unable to save document");
            return GenericResponse::builder()
                .message("unable to save document")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let key = build_cloud_storage_bucket_document_key(
        &document.owner,
        &document.document_id,
        document.document_version_id,
        Some(file_type.as_str()),
    );

    if let Err(e) = state.s3_client.upload_document(&key, file_content).await {
        tracing::error!(error=?e, "unable to upload document");
        utils::cleanup_document_version_on_error(
            &state.db,
            document_id.as_str(),
            document.document_version_id,
            file_type.as_str(),
        )
        .await;
        return GenericResponse::builder()
            .message("unable to upload document")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    };

    let document_response_metadata =
        match DocumentResponseMetadata::from_document_metadata(&document) {
            Ok(document_response_metadata) => document_response_metadata,
            Err(e) => {
                tracing::error!(error=?e, "unable to get document response metadata");
                return GenericResponse::builder()
                    .message("unable to get document response metadata")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    let response_data = SaveDocumentResponseData {
        document_metadata: document_response_metadata,
        presigned_url: None,
    };
    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}

async fn get_file_content(multipart: &mut Multipart) -> anyhow::Result<Vec<u8>> {
    while let Some(field) = multipart.next_field().await.context("expected field")? {
        let name = field.name().context("expected field name")?.to_string();

        if name == "file" {
            let data = field.bytes().await.context("expected bytes")?;
            return Ok(data.to_vec());
        }
    }

    Err(anyhow::anyhow!("no file present"))
}
