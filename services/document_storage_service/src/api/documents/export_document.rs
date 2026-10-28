use std::str::FromStr;

use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use documents_hex::domain::docx_export::{DocxExport, export_docx};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::{
    document::{DocumentBasic, FileType, response::LocationResponseData},
    response::{ErrorResponse, GenericErrorResponse},
};
use model_owner::Owner;

use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::location::get_presigned_url_by_type;

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
            (status = 409, description = "DOCX upload is still processing; retry the export.", body=ErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user, access), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn handler(
    access: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService, AuthorizationService>,
    Path(Params { .. }): Path<Params>,
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    document_context: Extension<DocumentBasic>,
) -> Result<Response, Response> {
    tracing::info!("export document");
    if let Some(file_type) = document_context.file_type.as_deref() {
        let file_type = FileType::from_str(file_type).map_err(|e| {
            tracing::error!(error=?e, "unable to convert file type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to convert file type".into(),
                }),
            )
                .into_response()
        })?;

        let presigned_url = match file_type {
            FileType::Docx => match export_docx(&state, access.entity_access_receipt).await {
                Ok(DocxExport::Ready(url)) => Ok(url),
                Ok(DocxExport::Processing) => {
                    return Ok((
                        StatusCode::CONFLICT,
                        [(axum::http::header::RETRY_AFTER, "1")],
                        Json(ErrorResponse {
                            message: "Document is still processing. Please retry shortly.".into(),
                        }),
                    )
                        .into_response());
                }
                Err(error) => Err(anyhow::Error::new(error)),
            },
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
                    message: "unable to export document".into(),
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
                message: "cannot export document with no file type".into(),
            }),
        )
            .into_response())
    }
}

/// Wrapper for get_presigned_url_by_type to export basic documents
async fn export_basic_document(
    ctx: &ApiContext,
    owner: &Owner,
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
            anyhow::bail!("expected presigned url type only")
        }
    }
}
