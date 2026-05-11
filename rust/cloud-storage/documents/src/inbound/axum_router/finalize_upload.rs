//! Handler for `POST /documents/{document_id}/finalize_upload`.

use std::str::FromStr;

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::{DocumentBasic, FileType};
use model::response::{GenericSuccessResponse, SuccessResponse};
use model_entity::EntityType;
use models_permissions::share_permission::access_level::{EditAccessLevel, ViewAccessLevel};

use super::{DocumentRouterState, Params};
use crate::domain::content::{DocumentContentState, LocationResponseV3};
use crate::domain::models::{DocumentError, LocationQueryParams};
use crate::domain::ports::DocumentService;
use crate::domain::upload_finalize::UploadedDocumentFinalizer;

/// Handler for `POST /documents/{document_id}/finalize_upload`.
///
/// Compatibility/manual finalization endpoint.
///
/// Browser S3 uploads are finalized by the S3 ObjectCreated event pipeline.
/// This endpoint remains for legacy frontend-created markdown documents,
/// manual retry/debug, and temporary callers. For markdown S3 uploads it reads
/// the uploaded markdown from document storage, initializes sync-service, and
/// marks the document uploaded. Non-DOCX uploads are marked uploaded; DOCX
/// completion remains owned by the unzip/conversion pipeline.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/{document_id}/finalize_upload",
    operation_id = "finalize_document_upload",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = SuccessResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 410, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, document_context), err)]
pub async fn finalize_upload_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<SuccessResponse>, DocumentError> {
    let _ = access;

    let file_type = document_context
        .file_type
        .as_deref()
        .and_then(|file_type| FileType::from_str(file_type).ok());

    if matches!(file_type, Some(FileType::Docx)) {
        // DOCX upload finalization is owned by the unzip/conversion pipeline,
        // which marks the document uploaded after processing succeeds.
        return Ok(success());
    }

    let content = state
        .service
        .get_document_content(&document_context)
        .await?;
    if content.state == DocumentContentState::Ready {
        return Ok(success());
    }

    if matches!(file_type, Some(FileType::Md))
        && state
            .sync_service_client
            .exists(&document_id)
            .await
            .map_err(DocumentError::Internal)?
    {
        // Compatibility for legacy frontend-created markdown documents that
        // initialize sync-service directly and do not write an S3 object.
        // Browser S3 uploads no longer call this endpoint; ObjectCreated events
        // run the canonical upload finalizer without probing sync-service.
        state.service.mark_document_uploaded(&document_id).await?;
        return Ok(success());
    }

    let markdown = if matches!(file_type, Some(FileType::Md)) {
        let Some(presigned_url) = uploaded_document_presigned_url(
            state.service.as_ref(),
            &document_context,
            &document_id,
        )
        .await?
        else {
            state.service.mark_document_uploaded(&document_id).await?;
            return Ok(success());
        };

        Some(download_markdown(&presigned_url).await?)
    } else {
        None
    };

    let finalizer = UploadedDocumentFinalizer::new(
        state.service.as_ref(),
        state.lexical_client.as_ref(),
        state.sync_service_client.as_ref(),
    );
    finalizer
        .finalize_uploaded_document(&document_context, markdown.as_deref())
        .await?;

    Ok(success())
}

async fn uploaded_document_presigned_url<T: DocumentService>(
    service: &T,
    document_context: &DocumentBasic,
    document_id: &str,
) -> Result<Option<String>, DocumentError> {
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
        document_id,
        EntityType::Document,
    );

    let location = service
        .get_document_location(
            document_context,
            receipt,
            LocationQueryParams {
                document_version_id: None,
                get_converted_docx_url: None,
            },
        )
        .await?;

    match location {
        LocationResponseV3::PresignedUrl { presigned_url, .. } => Ok(Some(presigned_url)),
        LocationResponseV3::SyncServiceContent { .. } => Ok(None),
        LocationResponseV3::PresignedUrls { .. } => Err(DocumentError::BadRequest(
            "markdown upload resolved to multiple storage objects".to_string(),
        )),
    }
}

async fn download_markdown(presigned_url: &str) -> Result<String, DocumentError> {
    let response = reqwest::get(presigned_url)
        .await
        .map_err(|error| DocumentError::Internal(error.into()))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(DocumentError::Internal(anyhow::anyhow!(
            "failed to download markdown upload: {status} {body}"
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| DocumentError::Internal(error.into()))?;

    String::from_utf8(bytes.to_vec()).map_err(|error| {
        DocumentError::BadRequest(format!("markdown upload is not valid utf-8: {error}"))
    })
}

fn success() -> Json<SuccessResponse> {
    Json(SuccessResponse {
        error: false,
        data: GenericSuccessResponse::default(),
    })
}
