use crate::{
    api::context::ApiContext,
    model::{
        request::documents::save::PreSaveDocumentRequest,
        response::documents::save::{PreSaveDocumentResponse, PreSaveDocumentResponseData},
    },
};
use axum::{
    Extension,
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};

#[allow(unused_imports)]
use futures::stream::StreamExt;
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{response::GenericErrorResponse, user::UserContext};

use model::{
    document::{ContentType, DocumentBasic, FileType},
    response::{GenericResponse, PresignedUrl},
};

use models_permissions::share_permission::access_level::EditAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Takes the docx document bom parts and generates presigned urls to upload
/// any new content
#[utoipa::path(
        tag = "document",
        put,
        path = "/documents/presave/{document_id}",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=PreSaveDocumentResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        ),
    )]
#[tracing::instrument(skip(state, document_context, user_context, req), fields(user_id=?user_context.user_id))]
#[allow(deprecated, reason = "we just want deprecated to show up in utoipa")]
#[deprecated(note = "we no longer support editing docx files as they are now converted to pdf.")]
pub async fn presave_document_handler(
    access: DocumentAccessExtractor<EditAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Json(req): Json<PreSaveDocumentRequest>,
) -> impl IntoResponse {
    tracing::trace!("pre saving document");
    // Ensure we have a valid file type
    let file_type: FileType = match document_context
        .file_type
        .as_deref()
        .and_then(|f| f.try_into().ok())
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

    // We only allow pre save on docx
    // Since we require the document version id for the pdf to be saved we cannot
    // perform a presave on pdfs
    if file_type == FileType::Pdf {
        return GenericResponse::builder()
            .message("cannot perform pre save on pdf")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    tracing::trace!("finding non existing shas");
    // Check all bom parts in redis to see if they exist in s3
    let non_existing_shas = match state
        .redis_client
        .find_non_existing_shas(&req.new_bom)
        .await
    {
        Ok(non_existing_bom_parts) => non_existing_bom_parts,
        Err(e) => {
            tracing::error!(error=?e, "unable to find non existing shas");
            return GenericResponse::builder()
                .message("unable to find non existing shas")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if non_existing_shas.is_empty() {
        return GenericResponse::builder()
            .data(&PreSaveDocumentResponseData {
                presigned_urls: vec![],
            })
            .is_error(false)
            .send(StatusCode::OK);
    }

    // Generate presigned urls for any parts that are not in s3
    let shared_s3_client = &state.s3_client;
    tracing::trace!("generating presigned urls");
    let presigned_urls: Vec<anyhow::Result<PresignedUrl>> =
        futures::stream::iter(non_existing_shas.iter())
            .then(|bp| async move {
                match shared_s3_client
                    .put_document_storage_presigned_url(&bp.sha, &bp.sha, ContentType::Default)
                    .await
                {
                    Ok(presigned_url) => Ok(PresignedUrl {
                        sha: bp.sha.clone(),
                        presigned_url,
                    }),
                    Err(err) => {
                        tracing::error!(
                            error=?err,
                            sha=%bp.sha,
                            "error generating presigned url for sha",
                        );
                        Err(err)
                    }
                }
            })
            .collect::<Vec<anyhow::Result<PresignedUrl>>>()
            .await;

    // If any of the presigned urls failed, return an error
    if presigned_urls.iter().filter(|r| r.is_err()).count() > 0 {
        return GenericResponse::builder()
            .message("unable to generate presigned urls")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let presigned_urls: Vec<PresignedUrl> =
        presigned_urls.into_iter().filter_map(|r| r.ok()).collect();

    GenericResponse::builder()
        .data(&PreSaveDocumentResponseData { presigned_urls })
        .send(StatusCode::OK)
}
