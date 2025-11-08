use crate::api::context::ApiContext;
use anyhow::anyhow;
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use rayon::prelude::*;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    model::request::documents::location::LocationQueryParams,
    service::{self},
};
use axum::{
    Extension,
    body::Body,
    extract::{Path, Query, State},
    http::{Response, StatusCode},
    response::{IntoResponse, Response as AxumResponse},
};
use cloudfront_sign::{SignedOptions, get_signed_url};
use futures::{FutureExt, pin_mut, select};
use model::{
    document::{
        CONVERTED_DOCUMENT_FILE_NAME, DocumentBasic, FileType,
        build_cloud_storage_bucket_document_key, response::LocationResponseData,
        response::LocationResponseV3,
    },
    response::{GenericErrorResponse, GenericResponse, PresignedUrl},
    user::UserContext,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

static DOCUMENT_DOES_NOT_EXIST: &str = "document does not exist in s3";

/// Attempts to retrieve metadata from sync service using optimized concurrent exists/metadata checks
async fn try_get_from_sync_service(
    sync_service_client: &sync_service_client::SyncServiceClient,
    document_id: &str,
) -> Result<Option<model::sync_service::DocumentMetadata>, anyhow::Error> {
    let exists_fut = sync_service_client.exists(document_id).fuse();
    let metadata_fut = sync_service_client.get_metadata(document_id).fuse();

    pin_mut!(exists_fut, metadata_fut);

    // Use select to handle whichever completes first for better performance
    select! {
        exists_result = exists_fut => {
            match exists_result {
                Ok(false) => Ok(None),
                Ok(true) | Err(_) => {
                    metadata_fut.await.map(Some)
                }
            }
        },
        metadata_result = metadata_fut => {
            match metadata_result {
                Ok(metadata) => Ok(Some(metadata)),
                Err(e) => {
                    match exists_fut.await {
                        Ok(false) => Ok(None),
                        _ => Err(e),
                    }
                }
            }
        }
    }
}

#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/location_v3",
    params(
        ("document_id" = String, Path, description = "Document ID"),
        ("document_version_id" = i64, Query, description = "A specific document version id to get the location for."),
        ("get_converted_docx_url" = bool, Query, description = "If true, this will return the converted docx url.")
    ),
    responses(
        (status = 200, body=LocationResponseV3),
        (status = 401, body=GenericErrorResponse),
        (status = 404, body=GenericErrorResponse),
        (status = 410, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(user_context, document_context, state, _access), fields(user_id=?user_context.user_id))]
pub async fn get_location_handler_v3(
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<LocationQueryParams>,
) -> AxumResponse {
    let file_type = document_context.try_file_type();

    let make_result = |response: anyhow::Result<LocationResponseV3>| {
        let response_data: LocationResponseV3 = match response {
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

        let max_age = state.config.presigned_url_browser_cache_expiry_seconds;

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
    };

    // do sync service check for markdown files
    if matches!(file_type, Some(FileType::Md)) {
        match try_get_from_sync_service(&state.sync_service_client, &document_id).await {
            Ok(Some(sync_service_metadata)) => {
                let data = LocationResponseV3::SyncServiceContent {
                    metadata: document_context,
                    sync_service_metadata,
                };
                return make_result(Ok(data)).into_response();
            }
            Ok(None) => {
                // Document doesn't exist in sync service, continue to check S3
            }
            Err(e) => {
                tracing::error!(error=?e, "sync service failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    }

    let response_data = get_presigned_url_by_type(
        &state,
        &document_context.owner,
        &document_id,
        file_type,
        params.document_version_id,
        params.get_converted_docx_url.unwrap_or(false),
    )
    .await
    .map(|response| match response {
        LocationResponseData::PresignedUrl(url) => LocationResponseV3::PresignedUrl {
            presigned_url: url,
            metadata: document_context,
        },
        LocationResponseData::PresignedUrls(urls) => LocationResponseV3::PresignedUrls {
            presigned_urls: urls,
            metadata: document_context,
        },
    });
    make_result(response_data).into_response()
}

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
    _access_level: DocumentAccessExtractor<ViewAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    params: Query<LocationQueryParams>,
) -> impl IntoResponse {
    let file_type: Option<FileType> = document_context
        .file_type
        .as_deref()
        .and_then(|f| f.try_into().ok());

    let response_data = get_presigned_url_by_type(
        &state,
        &document_context.owner,
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

    let max_age = state.config.presigned_url_browser_cache_expiry_seconds;

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

#[tracing::instrument(skip(state))]
async fn get_editable_url(
    state: &ApiContext,
    owner: &str,
    document_id: &str,
    document_version_id: Option<i64>,
    file_type: &str,
) -> anyhow::Result<LocationResponseData> {
    let url_encoded_owner = urlencoding::encode(owner);
    let document_version_id = if let Some(document_version_id) = document_version_id {
        document_version_id
    } else {
        macro_db_client::document::get_latest_document_version_id(&state.db, document_id)
            .await?
            .0
    };

    let document_key = build_cloud_storage_bucket_document_key(
        &url_encoded_owner,
        document_id,
        document_version_id,
        Some(file_type),
    );

    // Check if the item exists in s3
    #[cfg(not(feature = "disable_location_check"))]
    {
        // NOTE: owner is not url encoded
        let document_key = build_cloud_storage_bucket_document_key(
            owner,
            document_id,
            document_version_id,
            Some(file_type),
        );
        tracing::trace!("checking if file exists in s3, key: {}", document_key);
        let exists = verify_file_exists(&state.s3_client, &document_key).await?;
        if !exists {
            return Err(anyhow!(DOCUMENT_DOES_NOT_EXIST));
        }
    }

    let signed_options = get_cloudfront_signed_options(
        &state.config.vars.cloudfront_signer_public_key_id,
        state.config.cloudfront_signer_private_key.as_ref(),
        state.config.presigned_url_expiry_seconds,
    );

    let signed_url = get_presigned_url(
        &state.config.vars.cloudfront_distribution_url,
        &document_key,
        &signed_options,
    )?;

    Ok(LocationResponseData::PresignedUrl(signed_url))
}

#[tracing::instrument(skip(state))]
pub(in crate::api::documents) async fn get_static_url(
    state: &ApiContext,
    owner: &str,
    document_id: &str,
    file_type: &Option<FileType>,
) -> anyhow::Result<LocationResponseData> {
    let url_encoded_owner = urlencoding::encode(owner);
    let (document_version_id, _) =
        macro_db_client::document::get_document_version_id(&state.db, document_id).await?;

    let file_type_str = file_type.as_ref().map(|s| s.as_str());
    let document_key = build_cloud_storage_bucket_document_key(
        &url_encoded_owner,
        document_id,
        document_version_id,
        file_type_str,
    );

    // Check if the item exists in s3
    #[cfg(not(feature = "disable_location_check"))]
    {
        // NOTE: owner is not url encoded
        let document_key = build_cloud_storage_bucket_document_key(
            owner,
            document_id,
            document_version_id,
            file_type_str,
        );
        tracing::trace!("checking if file exists in s3, key: {}", document_key);
        let exists = verify_file_exists(&state.s3_client, &document_key).await?;
        if !exists {
            return Err(anyhow!(DOCUMENT_DOES_NOT_EXIST));
        }
    }

    let signed_options = get_cloudfront_signed_options(
        &state.config.vars.cloudfront_signer_public_key_id,
        state.config.cloudfront_signer_private_key.as_ref(),
        state.config.presigned_url_expiry_seconds,
    );

    let signed_url = get_presigned_url(
        &state.config.vars.cloudfront_distribution_url,
        &document_key,
        &signed_options,
    )?;

    Ok(LocationResponseData::PresignedUrl(signed_url))
}

/// Gets the presigned url for the converted docx file
#[tracing::instrument(skip(state))]
async fn get_converted_docx_url(
    state: &ApiContext,
    owner: &str,
    document_id: &str,
) -> anyhow::Result<LocationResponseData> {
    let url_encoded_owner = urlencoding::encode(owner);
    let document_key = format!(
        "{}/{}/{}.pdf",
        url_encoded_owner, document_id, CONVERTED_DOCUMENT_FILE_NAME
    );

    // Check if the item exists in s3
    #[cfg(not(feature = "disable_location_check"))]
    {
        let document_key = format!(
            "{}/{}/{}.pdf",
            owner, document_id, CONVERTED_DOCUMENT_FILE_NAME
        );
        tracing::trace!("checking if file exists in s3, key: {}", document_key);
        let exists = verify_file_exists(&state.s3_client, &document_key).await?;
        if !exists {
            return Err(anyhow!(DOCUMENT_DOES_NOT_EXIST));
        }
    }

    let signed_options = get_cloudfront_signed_options(
        &state.config.vars.cloudfront_signer_public_key_id,
        state.config.cloudfront_signer_private_key.as_ref(),
        state.config.presigned_url_expiry_seconds,
    );

    let signed_url = get_presigned_url(
        &state.config.vars.cloudfront_distribution_url,
        &document_key,
        &signed_options,
    )?;

    Ok(LocationResponseData::PresignedUrl(signed_url))
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
        &state.config.vars.cloudfront_signer_public_key_id,
        state.config.cloudfront_signer_private_key.as_ref(),
        state.config.presigned_url_expiry_seconds,
    );

    let cloudfront_distribution_url = state.config.vars.cloudfront_distribution_url.as_ref();

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
        return Err(anyhow!("unable to generate presigned urls"));
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
        None => {
            // no file type will always be static
            get_static_url(state, owner, document_id, &file_type).await
        }
        Some(file_type) => {
            if file_type == FileType::Docx && get_converted_docx {
                tracing::debug!("getting converted docx url");
                get_converted_docx_url(state, owner, document_id).await
            } else if file_type == FileType::Docx && !get_converted_docx {
                tracing::debug!("getting legacy docx urls");
                get_docx_urls(state, document_id, document_version_id).await
            } else if file_type.is_static() {
                get_static_url(state, owner, document_id, &Some(file_type)).await
            } else {
                get_editable_url(
                    state,
                    owner,
                    document_id,
                    document_version_id,
                    file_type.as_str(),
                )
                .await
            }
        }
    }
}

/// Makes a cloudfront presigned url for the provided key
#[tracing::instrument(skip(options))]
pub(in crate::api::documents) fn get_presigned_url(
    cloudfront_distribution_url: &str,
    key: &str,
    options: &SignedOptions,
) -> anyhow::Result<String> {
    let constructed_url = format!("{}/{}", cloudfront_distribution_url, key);

    let signed_url = get_signed_url(&constructed_url, options)?;
    Ok(signed_url)
}

async fn verify_file_exists(
    s3_client: &service::s3::S3,
    document_key: &str,
) -> anyhow::Result<bool> {
    s3_client.exists(document_key).await
}
