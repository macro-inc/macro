use std::{collections::HashSet, str::FromStr};

use crate::{
    api::context::ApiContext,
    model::{
        request::documents::save::PreSaveDocumentRequest,
        response::documents::save::{PreSaveDocumentResponse, PreSaveDocumentResponseData},
    },
    service::s3::S3,
};
use axum::{
    Extension,
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::api::context::{AuthorizationService, EntityAccessService};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use futures::stream::{StreamExt, TryStreamExt};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::GenericErrorResponse;

use model::{
    document::{ContentType, DocumentBasic, FileType, SaveBomPart},
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
#[tracing::instrument(skip(state, document_context, user, req, _access), fields(user_id=?user.authorization.user.macro_user_id))]
#[allow(deprecated, reason = "we just want deprecated to show up in utoipa")]
#[deprecated(note = "we no longer support editing docx files as they are now converted to pdf.")]
pub async fn presave_document_handler(
    _access: DocumentAccessExtractor<EditAccessLevel, EntityAccessService, AuthorizationService>,
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Json(req): Json<PreSaveDocumentRequest>,
) -> impl IntoResponse {
    tracing::trace!("pre saving document");
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

    // We only allow pre save on docx
    // Since we require the document version id for the pdf to be saved we cannot
    // perform a presave on pdfs
    if file_type == FileType::Pdf {
        return GenericResponse::builder()
            .message("cannot perform pre save on pdf")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    let missing_shas = match missing_shas(&state.s3_client, &req.new_bom).await {
        Ok(missing_shas) => missing_shas,
        Err(e) => {
            tracing::error!(error=?e, "unable to check which document parts are stored");
            return GenericResponse::builder()
                .message("unable to check which document parts are stored")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if missing_shas.is_empty() {
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
        futures::stream::iter(missing_shas.iter())
            .then(|sha| async move {
                match shared_s3_client
                    .put_document_storage_presigned_url(sha, sha, ContentType::Default)
                    .await
                {
                    Ok(presigned_url) => Ok(PresignedUrl {
                        sha: sha.clone(),
                        presigned_url,
                    }),
                    Err(err) => {
                        tracing::error!(
                            error=?err,
                            sha=%sha,
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

/// How many `HeadObject` requests one presave keeps in flight.
const CONCURRENT_PART_CHECKS: usize = 16;

/// The distinct SHAs in `bom` with no object in the document storage bucket,
/// which the client must upload. S3 is the only record of what is stored.
#[tracing::instrument(
    name = "docx.presave_check",
    skip_all,
    fields(part_count = bom.len(), missing_count = tracing::field::Empty),
    err
)]
async fn missing_shas(s3: &S3, bom: &[SaveBomPart]) -> anyhow::Result<Vec<String>> {
    let distinct_shas: HashSet<String> = bom.iter().map(|part| part.sha.clone()).collect();
    let mut missing_shas: Vec<String> = futures::stream::iter(distinct_shas)
        .map(|sha| async move {
            let stored = s3.exists(&sha).await?;
            anyhow::Ok((!stored).then_some(sha))
        })
        .buffer_unordered(CONCURRENT_PART_CHECKS)
        .try_filter_map(|missing| async move { Ok(missing) })
        .try_collect()
        .await?;
    missing_shas.sort();
    tracing::Span::current().record("missing_count", missing_shas.len());
    Ok(missing_shas)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_parts_missing_from_s3_need_uploading() {
        let mut s3 = S3::default();
        s3.expect_exists()
            .withf(|key| key == "stored")
            .times(1)
            .returning(|_| Ok(true));
        s3.expect_exists()
            .withf(|key| key == "new")
            .times(1)
            .returning(|_| Ok(false));

        let missing = missing_shas(
            &s3,
            &[
                SaveBomPart {
                    sha: "stored".to_string(),
                    path: "word/document.xml".to_string(),
                },
                SaveBomPart {
                    sha: "new".to_string(),
                    path: "word/media/image1.png".to_string(),
                },
                SaveBomPart {
                    sha: "new".to_string(),
                    path: "word/media/image2.png".to_string(),
                },
            ],
        )
        .await
        .unwrap();

        assert_eq!(missing, vec!["new".to_string()]);
    }

    #[tokio::test]
    async fn an_s3_error_fails_the_check() {
        let mut s3 = S3::default();
        s3.expect_exists()
            .withf(|key| key == "stored")
            .returning(|_| Ok(true));
        s3.expect_exists()
            .withf(|key| key == "unreadable")
            .times(1)
            .returning(|_| Err(anyhow::anyhow!("access denied")));

        let result = missing_shas(
            &s3,
            &[
                SaveBomPart {
                    sha: "stored".to_string(),
                    path: "word/document.xml".to_string(),
                },
                SaveBomPart {
                    sha: "unreadable".to_string(),
                    path: "word/styles.xml".to_string(),
                },
            ],
        )
        .await;

        assert!(result.is_err());
    }
}
