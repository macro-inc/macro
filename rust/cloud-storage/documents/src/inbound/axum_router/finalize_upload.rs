//! Handler for `POST /documents/{document_id}/finalize_upload`.

use std::str::FromStr;

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::response::LocationResponseV3;
use model::document::{DocumentBasic, FileType};
use model::response::{GenericSuccessResponse, SuccessResponse};
use model_entity::EntityType;
use models_permissions::share_permission::access_level::{EditAccessLevel, ViewAccessLevel};

use super::{DocumentRouterState, Params};
use crate::domain::create::MarkdownInitializer;
use crate::domain::models::{DocumentError, LocationQueryParams};
use crate::domain::ports::DocumentService;

/// Handler for `POST /documents/{document_id}/finalize_upload`.
///
/// Finalizes caller-managed uploads after the bytes have been PUT to the
/// presigned URL. For markdown uploads this reads the uploaded markdown from
/// document storage and initializes sync-service. Non-markdown uploads are a
/// no-op so callers can safely finalize every uploaded document.
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

    if !matches!(file_type, Some(FileType::Md)) {
        return Ok(success());
    }

    if state
        .sync_service_client
        .exists(&document_id)
        .await
        .map_err(DocumentError::Internal)?
    {
        return Ok(success());
    }

    let Some(presigned_url) =
        uploaded_document_presigned_url(state.service.as_ref(), &document_context, &document_id)
            .await?
    else {
        return Ok(success());
    };

    let markdown = download_markdown(&presigned_url).await?;

    let initializer = MarkdownInitializer::new(
        state.lexical_client.as_ref(),
        state.sync_service_client.as_ref(),
    );

    match initializer
        .initialize_existing_markdown(&document_id, &markdown)
        .await
    {
        Ok(()) => Ok(success()),
        Err(error) => {
            // Make finalize idempotent across retries/races.
            if state
                .sync_service_client
                .exists(&document_id)
                .await
                .map_err(DocumentError::Internal)?
            {
                Ok(success())
            } else {
                Err(error)
            }
        }
    }
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
