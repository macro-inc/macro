use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use cloudfront_sign::{SignedOptions, get_signed_url};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::attachment;
use models_email::email::service::link::Link;
use models_email::service;
use std::time::{SystemTime, UNIX_EPOCH};
use utoipa::ToSchema;
use uuid::Uuid;

/// The response returned from the get attachment endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetAttachmentResponse {
    pub attachment: attachment::Attachment,
}

/// Get an attachment by ID.
#[utoipa::path(
    get,
    tag = "Attachments",
    path = "/email/attachments/{id}",
    operation_id = "get_attachment",
    params(
        ("id" = Uuid, Path, description = "Attachment ID."),
    ),
    responses(
            (status = 200, body=Vec<GetAttachmentResponse>),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link, gmail_token), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id
))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Path(attachment_id): Path<Uuid>,
) -> Result<Response, Response> {
    // get attachment metadata from db
    let (mut db_attachment, message_provider_id) =
        email_db_client::attachments::provider::fetch_attachment_by_id(
            &ctx.db,
            attachment_id,
            link.id,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "error fetching attachment from db");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "error fetching attachment",
                }),
            )
                .into_response()
        })?
        .ok_or_else(|| {
            tracing::warn!(
                "attachment with id {} for link {} not found",
                attachment_id,
                link.id
            );
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "attachment does not exist",
                }),
            )
                .into_response()
        })?;

    let bucket = &ctx.config.attachment_bucket;

    // Create an object key that combines link_id and attachment_id
    let object_key = format!(
        "{}/{}-{}",
        link.id,
        attachment_id,
        db_attachment.filename.clone().unwrap_or_default()
    );

    // check if it exists in s3 already
    let exists = ctx
        .s3_client
        .exists(bucket, &object_key)
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "error checking if attachment exists in S3");
            false
        })
        .unwrap_or(false);

    let presigned_url = if exists {
        // Object already exists, just generate a presigned URL
        let presigned_request = get_presigned_url(&ctx, &object_key).await
            .map_err(|e| {
                tracing::warn!(error=?e, "Failed to generate presigned URL for attachment_id {} in bucket {} with key {}",
                attachment_id, bucket, object_key);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "error fetching attachment",
                    }),
                )
                    .into_response()
            })?;
        presigned_request.to_string()
    } else {
        // Object doesn't exist, need to fetch from Gmail and upload
        // fetch attachment data from gmail api
        let attachment_data = ctx
            .gmail_client
            .get_attachment_data(
                gmail_token.as_str(),
                &message_provider_id,
                db_attachment.provider_id.as_ref().unwrap(),
            )
            .await
            .map_err(|e| {
                tracing::warn!(error=?e, "error fetching attachment from Gmail API");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "error fetching attachment",
                    }),
                )
                    .into_response()
            })?;

        // upload attachment to s3 and get presigned url
        upload_single_attachment(
            &ctx,
            bucket,
            &object_key,
            link.id,
            &mut db_attachment,
            attachment_data,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "error uploading attachment to S3");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "error uploading attachment",
                }),
            )
                .into_response()
        })?
    };

    // set presigned url in object
    db_attachment.data_url = Some(presigned_url);

    Ok((
        StatusCode::OK,
        Json(GetAttachmentResponse {
            attachment: db_attachment,
        }),
    )
        .into_response())
}

/// Uploads the data for a single attachment to S3, updates the attachment's metadata,
/// and returns a presigned URL for accessing the attachment
#[tracing::instrument(skip(state, attachment_data), level = "info", err)]
pub async fn upload_single_attachment(
    state: &ApiContext,
    bucket: &str,
    object_key: &str,
    link_id: Uuid,
    attachment: &mut service::attachment::Attachment,
    attachment_data: Vec<u8>,
) -> anyhow::Result<String> {
    if cfg!(feature = "disable_attachment_upload") {
        attachment.data_url = Some("https://example.com/mock-url".to_string());
        return Ok("https://example.com/mock-url".to_string());
    }

    // Ensure attachment has a db_id
    let attachment_id = attachment
        .db_id
        .ok_or_else(|| anyhow::anyhow!("Attachment must have a db_id to generate an object key"))?;

    // Create an object key that combines link_id and attachment_id
    let object_key = format!(
        "{}/{}-{}",
        link_id,
        attachment_id,
        attachment.filename.clone().unwrap_or_default()
    );

    // Upload the attachment data to S3
    match state
        .s3_client
        .put(bucket, &object_key, attachment_data.as_slice())
        .await
    {
        Ok(_) => {
            // Generate a presigned URL for the uploaded attachment
            let presigned_url = get_presigned_url(state, &object_key)
                .await
                .with_context(|| {
                    format!(
                        "Failed to generate presigned URL for attachment_id {} in bucket {} with key {}",
                        attachment_id, bucket, object_key
                    )
                })?;

            let url_string = presigned_url.to_string();

            // Update the attachment with the presigned URL
            attachment.data_url = Some(url_string.clone());

            Ok(url_string)
        }
        Err(e) => {
            // Log error with detailed context
            tracing::error!(
                "Failed to upload attachment: {} - link_id: {}, attachment_id: {}, content_length: {}, bucket: {}, key: {}",
                e,
                link_id,
                attachment_id,
                attachment_data.len(),
                bucket,
                object_key
            );
            Err(e)
        }
    }
}

// get a presigned cloudfront url for the attachment
async fn get_presigned_url(state: &ApiContext, key: &str) -> anyhow::Result<String> {
    let encoded_key = urlencoding::encode(key);
    let presigned_url_expiry_secs = state.config.presigned_url_ttl_secs;
    let public_key_id = state.config.cloudfront_signer_public_key_id.clone();
    let private_key = state.config.cloudfront_signer_private_key.as_ref();
    let url = state.config.cloudfront_distribution_url.clone();

    let current_unix_timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let date_less_than = current_unix_timestamp + presigned_url_expiry_secs;

    let signed_options = SignedOptions {
        key_pair_id: public_key_id.to_string(),
        date_less_than,
        private_key: private_key.to_string(),
        ..Default::default()
    };

    let constructed_url = format!("{}/{}", url, encoded_key);

    let signed_url = get_signed_url(&constructed_url, &signed_options)?;
    Ok(signed_url)
}
