use crate::api::context::ApiContext;
use crate::api::context::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use rayon::prelude::*;
use std::{
    str::FromStr,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::model::request::documents::location::LocationQueryParams;
use axum::{
    Extension,
    body::Body,
    extract::{Path, Query, State},
    http::{Response, StatusCode},
    response::IntoResponse,
};
use cloudfront_sign::{SignedOptions, get_signed_url};
use model::{
    document::{DocumentBasic, FileType, FileTypeExt, response::LocationResponseData},
    response::{GenericErrorResponse, GenericResponse, PresignedUrl},
    user::UserContext,
};
use s3_key::{build_cloud_storage_bucket_document_key, build_docx_to_pdf_converted_document_key};

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

static DOCUMENT_DOES_NOT_EXIST: &str = "document does not exist in s3";

/// Gets the presigned url(s) for the document. aka location
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/location",
    params(
        ("document_id" = String, Path, description = "Document ID"),
        ("document_version_id" = i64, Query, description = "A specific document version id to get the location for."),
        ("get_converted_docx_url" = bool, Query, description = "If true, this will return the converted docx url.")
    ),
    responses(
        (status = 200, body=LocationResponseData),
        (status = 401, body=GenericErrorResponse),
        (status = 404, body=GenericErrorResponse),
        (status = 410, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, document_context, _access_level), fields(user_id=?user_context.user_id))]
pub async fn get_location_handler(
    _access_level: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    params: Query<LocationQueryParams>,
) -> impl IntoResponse {
    let file_type: Option<FileType> = document_context
        .file_type
        .as_deref()
        .and_then(|f| FileType::from_str(f).ok());

    let response_data = get_presigned_url_by_type(
        &state,
        document_context.owner.as_ref(),
        &document_id,
        file_type,
        params.document_version_id,
        params.get_converted_docx_url.unwrap_or(false),
    )
    .await;

    let response_data = match response_data {
        Ok(response_data) => response_data,
        Err(e) => {
            tracing::error!(error=?e, "unable to get document location");
            let status_code = if e.to_string() == DOCUMENT_DOES_NOT_EXIST {
                tracing::error!("document does not exist in s3");
                StatusCode::GONE
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            return GenericResponse::builder()
                .message("unable to get document location")
                .is_error(true)
                .send(status_code);
        }
    };

    let max_age = state
        .config
        .document_storage_service_presigned_url_browser_cache_expiry_seconds;

    Response::builder()
        .status(StatusCode::OK)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("Cache-Control", format!("max-age={}", max_age))
        .header(
            "X-custom-response-uuid",
            macro_uuid::generate_uuid_v7().to_string(),
        ) // this is used to verify if a response is cached between requests
        .body(Body::from(serde_json::to_vec(&response_data).unwrap()))
        .unwrap()
}

/// Signs a document key and returns a CloudFront presigned URL.
/// `check_key` is the non-URL-encoded key for S3 existence verification.
/// `signed_key` is the URL-encoded key for the CloudFront signed URL.
#[tracing::instrument(skip(state), err)]
async fn sign_document_key(
    state: &ApiContext,
    #[allow(unused_variables)] check_key: &str,
    signed_key: &str,
) -> anyhow::Result<LocationResponseData> {
    #[cfg(feature = "location_check")]
    {
        tracing::trace!("checking if file exists in s3, key: {}", check_key);
        let exists = &state.s3_client.exists(check_key).await?;
        if !exists {
            anyhow::bail!(DOCUMENT_DOES_NOT_EXIST);
        }
    }

    let signed_options = get_cloudfront_signed_options(
        &state
            .config
            .document_storage_service_cloudfront_signer_public_key_id,
        state
            .config
            .document_storage_service_cloudfront_signer_private_key
            .as_ref(),
        state
            .config
            .document_storage_service_presigned_url_expiry_seconds,
    );

    let signed_url = get_presigned_url(
        &state
            .config
            .document_storage_service_cloudfront_distribution_url,
        signed_key,
        &signed_options,
    )?;

    Ok(LocationResponseData::PresignedUrl(signed_url))
}

/// Gets a signed CloudFront URL for a versioned document.
///
/// For static files (PDF, HTML), the version is always resolved from the DB.
/// For editable files (MD, Canvas), a caller-provided version ID is used if present,
/// otherwise the latest version is fetched.
#[tracing::instrument(skip(state))]
pub(in crate::api::documents) async fn get_versioned_url(
    state: &ApiContext,
    owner: &str,
    document_id: &str,
    document_version_id: Option<i64>,
    is_static: bool,
) -> anyhow::Result<LocationResponseData> {
    let document_version_id = match document_version_id {
        Some(v) if !is_static => v,
        _ if is_static => {
            macro_db_client::document::get_document_version_id(&state.db, document_id)
                .await?
                .0
        }
        _ => {
            macro_db_client::document::get_latest_document_version_id(&state.db, document_id)
                .await?
                .0
        }
    };

    let check_key =
        build_cloud_storage_bucket_document_key(owner, document_id, document_version_id);
    let url_encoded_owner = urlencoding::encode(owner);
    let signed_key = build_cloud_storage_bucket_document_key(
        &url_encoded_owner,
        document_id,
        document_version_id,
    );

    sign_document_key(state, &check_key, &signed_key).await
}

/// Gets the presigned url for the converted docx file
#[tracing::instrument(skip(state))]
async fn get_converted_docx_url(
    state: &ApiContext,
    owner: &str,
    document_id: &str,
) -> anyhow::Result<LocationResponseData> {
    let check_key = build_docx_to_pdf_converted_document_key(owner, document_id);
    let url_encoded_owner = urlencoding::encode(owner);
    let signed_key = build_docx_to_pdf_converted_document_key(&url_encoded_owner, document_id);

    sign_document_key(state, &check_key, &signed_key).await
}

#[tracing::instrument(skip(state))]
// #[deprecated(note = "use get_converted_docx_url instead")] // TODO FIXME undeprecated bc only
// used internally. Why is it not already just replaced with get_converted_docx_url? not enough
// info.
async fn get_docx_urls(
    state: &ApiContext,
    document_id: &str,
    document_version_id: Option<i64>,
) -> anyhow::Result<LocationResponseData> {
    let start_shas = std::time::Instant::now();
    // Get all shas
    let shas: Vec<String> = if let Some(document_version_id) = document_version_id {
        macro_db_client::document::document_shas::get_document_shas(&state.db, document_version_id)
            .await?
    } else {
        macro_db_client::document::document_shas::get_document_shas_by_document_id(
            &state.db,
            document_id,
        )
        .await?
    };
    tracing::debug!(elapsed = ?start_shas.elapsed(), "got document shas");

    let signed_options = get_cloudfront_signed_options(
        &state
            .config
            .document_storage_service_cloudfront_signer_public_key_id,
        state
            .config
            .document_storage_service_cloudfront_signer_private_key
            .as_ref(),
        state
            .config
            .document_storage_service_presigned_url_expiry_seconds,
    );

    let cloudfront_distribution_url = state
        .config
        .document_storage_service_cloudfront_distribution_url
        .as_ref();

    let start_presigned_urls = std::time::Instant::now();
    let presigned_urls: Vec<PresignedUrl> = shas
        .par_iter()
        .filter_map(|sha| {
            match get_presigned_url(cloudfront_distribution_url, sha, &signed_options) {
                Ok(url) => Some(PresignedUrl {
                    presigned_url: url,
                    sha: sha.to_string(),
                }),
                Err(e) => {
                    tracing::error!(error=?e, sha=?sha, "unable to generate presigned url");
                    None
                }
            }
        })
        .collect();

    if shas.len() != presigned_urls.len() {
        anyhow::bail!("unable to generate presigned urls");
    }
    tracing::debug!(elapsed = ?start_presigned_urls.elapsed(), "got presigned urls");

    Ok(LocationResponseData::PresignedUrls(presigned_urls))
}

/// Creates signed options for the cloudfront presigned url
#[tracing::instrument(skip(private_key))]
pub(in crate::api::documents) fn get_cloudfront_signed_options(
    public_key_id: &str,
    private_key: &str,
    presigned_url_expiry_seconds: u64,
) -> SignedOptions {
    let current_unix_timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let date_less_than = current_unix_timestamp + presigned_url_expiry_seconds;

    SignedOptions {
        key_pair_id: public_key_id.to_string(),
        date_less_than,
        private_key: private_key.to_string(),
        ..Default::default()
    }
}

/// Helper function to get the appropriate presigned URL based on file type (static vs editable)
#[tracing::instrument(skip(state))]
pub(in crate::api::documents) async fn get_presigned_url_by_type(
    state: &ApiContext,
    owner: &str,
    document_id: &str,
    file_type: Option<FileType>,
    document_version_id: Option<i64>,
    get_converted_docx: bool,
) -> anyhow::Result<LocationResponseData> {
    match file_type {
        None => get_versioned_url(state, owner, document_id, document_version_id, true).await,
        Some(file_type) => {
            if file_type == FileType::Docx && get_converted_docx {
                tracing::debug!("getting converted docx url");
                get_converted_docx_url(state, owner, document_id).await
            } else if file_type == FileType::Docx && !get_converted_docx {
                tracing::debug!("getting legacy docx urls");
                get_docx_urls(state, document_id, document_version_id).await
            } else {
                let is_static = file_type.is_static();
                get_versioned_url(state, owner, document_id, document_version_id, is_static).await
            }
        }
    }
}

/// Makes a cloudfront presigned url for the provided key
#[tracing::instrument(skip(options), err)]
pub(in crate::api::documents) fn get_presigned_url(
    cloudfront_distribution_url: &str,
    key: &str,
    options: &SignedOptions,
) -> anyhow::Result<String> {
    let constructed_url = format!("{}/{}", cloudfront_distribution_url, key);

    let signed_url = if !macro_aws_config::is_local_aws() {
        get_signed_url(&constructed_url, options)?
    } else {
        constructed_url
    };

    Ok(signed_url)
}
