use std::{
    io::{Cursor, Write},
    str::FromStr,
};

use crate::{api::context::ApiContext, service::s3::TEMP_FILE_PREFIX};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures::StreamExt;
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{
    document::{DocumentBasic, FileType, response::LocationResponseData},
    response::{ErrorResponse, GenericErrorResponse},
    user::UserContext,
};

use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::location::{
    get_cloudfront_signed_options, get_presigned_url, get_presigned_url_by_type,
};

#[allow(unused, reason = "this could probably be removed wait for tests")]
// The document_id field here is not used within the function handler body. Instead we use
// DocumentBasic::document_id which is the same thing (it comes from the same path) but it is
// handled in middleware
#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct ExportDocumentResponse {
    /// The presigned url to download the raw content of the document
    pub presigned_url: String,
}

/// Generates a presigned url to download the raw content of the document
/// For files with modification layers, they will not be applied in the downloaded file.
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/export",
        operation_id = "export_document",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=ExportDocumentResponse),
            (status = 304, body=GenericErrorResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context, _access), fields(user_id=?user_context.user_id))]
pub async fn handler(
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    Path(Params { .. }): Path<Params>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
) -> Result<Response, Response> {
    tracing::info!("export document");
    if let Some(file_type) = document_context.file_type.as_deref() {
        let file_type = FileType::from_str(file_type).map_err(|e| {
            tracing::error!(error=?e, "unable to convert file type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to convert file type",
                }),
            )
                .into_response()
        })?;

        let presigned_url = match file_type {
            FileType::Docx => export_docx_document(&state, &document_context.document_id).await,
            _ => {
                export_basic_document(
                    &state,
                    &document_context.owner,
                    &document_context.document_id,
                    file_type,
                )
                .await
            }
        }
        .map_err(|e| {
            tracing::error!(error=?e, "unable to export document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to export document",
                }),
            )
                .into_response()
        })?;

        Ok((
            StatusCode::OK,
            Json(ExportDocumentResponse { presigned_url }),
        )
            .into_response())
    } else {
        // If there is no file type on the document, we can't export it
        tracing::warn!("attempted to export document with no file type");
        Ok((
            StatusCode::NOT_IMPLEMENTED,
            Json(ErrorResponse {
                message: "cannot export document with no file type",
            }),
        )
            .into_response())
    }
}

/// Wrapper for get_presigned_url_by_type to export basic documents
async fn export_basic_document(
    ctx: &ApiContext,
    owner: &str,
    document_id: &str,
    file_type: FileType,
) -> anyhow::Result<String> {
    let result = get_presigned_url_by_type(
        ctx,
        owner,
        document_id,
        Some(file_type),
        None,  // document_version_id not needed for export
        false, // get_converted_docx_url not needed for basic export
    )
    .await?;
    match result {
        LocationResponseData::PresignedUrl(presigned_url) => Ok(presigned_url),
        LocationResponseData::PresignedUrls(_) => {
            Err(anyhow::anyhow!("expected presigned url type only"))
        }
    }
}

async fn export_docx_document(state: &ApiContext, document_id: &str) -> anyhow::Result<String> {
    let docx_key = format!("{TEMP_FILE_PREFIX}/{document_id}.docx");
    let exists = state.s3_client.exists(&docx_key).await?;

    if !exists {
        tracing::trace!("document does not exist in s3, downloading bom parts");
        let latest_document_bom_parts =
            macro_db_client::document::get_document_bom(state.db.clone(), document_id).await?;

        let shared_s3_client = &state.s3_client;

        #[expect(clippy::type_complexity, reason = "too annoying to fix now")]
        let downloaded_bom_parts: Vec<Result<(String, Vec<u8>), (String, anyhow::Error)>> =
            futures::stream::iter(latest_document_bom_parts.iter())
                .then(|bp| async move {
                    let content = shared_s3_client
                        .get_document(bp.sha.as_str())
                        .await
                        .map_err(|e| (bp.sha.clone(), e))?;

                    Ok((bp.path.clone(), content))
                })
                .collect()
                .await;

        if downloaded_bom_parts.iter().any(|r| r.is_err()) {
            return Err(anyhow::anyhow!("unable to download bom parts"));
        }

        let downloaded_bom_parts: Vec<(String, Vec<u8>)> = downloaded_bom_parts
            .into_iter()
            .filter_map(|r| r.ok())
            .collect();

        let writer = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(writer);

        for part in downloaded_bom_parts {
            zip.start_file::<_, ()>(part.0, zip::write::FileOptions::default())?;
            zip.write_all(&part.1)?;
        }

        let writer = zip.finish()?;
        let data = writer.into_inner();

        state.s3_client.upload_document(&docx_key, data).await?;
    }

    sign_docx_url(state, &docx_key).await
}

async fn sign_docx_url(state: &ApiContext, key: &str) -> anyhow::Result<String> {
    let encoded_key = urlencoding::encode(key);

    let signed_options = get_cloudfront_signed_options(
        &state.config.vars.cloudfront_signer_public_key_id,
        state.config.cloudfront_signer_private_key.as_ref(),
        state.config.presigned_url_expiry_seconds,
    );

    let signed_url = get_presigned_url(
        &state.config.vars.cloudfront_distribution_url,
        &encoded_key,
        &signed_options,
    )?;

    Ok(signed_url)
}
