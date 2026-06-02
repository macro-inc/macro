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
            (status = 200, body=GetAttachmentResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id
))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(attachment_id): Path<Uuid>,
) -> Result<Response, Response> {
    // Resolve which of the caller's inboxes owns this attachment. Each inbox is a
    // distinct Google account, so the owning link also determines the Gmail token.
    let links =
        email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, &user_context.user_id)
            .await
            .map_err(|e| {
                tracing::warn!(error=?e, "error fetching links");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "error fetching attachment".into(),
                    }),
                )
                    .into_response()
            })?;

    let mut owned = None;
    for link in links {
        if let Some((db_attachment, message_provider_id)) =
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
                        message: "error fetching attachment".into(),
                    }),
                )
                    .into_response()
            })?
        {
            owned = Some((db_attachment, message_provider_id, link));
            break;
        }
    }

    let (mut db_attachment, message_provider_id, link) = owned.ok_or_else(|| {
        tracing::warn!("attachment with id {} not found for caller", attachment_id);
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "attachment does not exist".into(),
            }),
        )
            .into_response()
    })?;

    let bucket = &ctx.config.attachment_bucket;

    // Create an object key that combines link_id and attachment_id
    let object_key =
        crate::generate_temp_attachment_s3_key!(link.id, attachment_id, db_attachment.filename);

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
                        message: "error fetching attachment".into(),
                    }),
                )
                    .into_response()
            })?;
        presigned_request.to_string()
    } else {
        // Object doesn't exist, need to fetch from Gmail and upload.
        // Use the owning inbox's own token, not the caller's primary inbox token.
        let gmail_token = email_service::util::gmail::auth::fetch_gmail_access_token_from_link(
            &link,
            &ctx.redis_client,
            &ctx.auth_service_client,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "error fetching gmail token for attachment inbox");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "error fetching attachment".into(),
                }),
            )
                .into_response()
        })?;

        let provider_attachment_id = db_attachment.provider_id.as_ref().ok_or_else(|| {
            tracing::warn!(attachment_id=%attachment_id, "attachment is missing a provider_id");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "error fetching attachment".into(),
                }),
            )
                .into_response()
        })?;

        // fetch attachment data from gmail api
        let attachment_data = ctx
            .gmail_client
            .get_attachment_data(
                gmail_token.as_str(),
                &message_provider_id,
                provider_attachment_id,
            )
            .await
            .map_err(|e| {
                tracing::warn!(error=?e, "error fetching attachment from Gmail API");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "error fetching attachment".into(),
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
                    message: "error uploading attachment".into(),
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
    if cfg!(not(feature = "attachment_upload")) {
        attachment.data_url = Some("https://example.com/mock-url".to_string());
        return Ok("https://example.com/mock-url".to_string());
    }

    // Upload the attachment data to S3
    match state
        .s3_client
        .put(bucket, object_key, attachment_data.as_slice())
        .await
    {
        Ok(_) => {
            // Generate a presigned URL for the uploaded attachment
            let presigned_url = get_presigned_url(state, object_key)
                .await
                .with_context(|| {
                    format!(
                        "Failed to generate presigned URL for attachment_id {} in bucket {} with key {}",
                        attachment.db_id, bucket, object_key
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
                attachment.db_id,
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
    let presigned_url_expiry_secs = state.config.email_service_presigned_url_ttl_secs;
    let public_key_id = state
        .config
        .email_service_cloudfront_signer_public_key_id
        .clone();
    let private_key = state
        .config
        .email_service_cloudfront_signer_private_key
        .as_ref();
    let url = state
        .config
        .email_service_cloudfront_distribution_url
        .clone();

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

#[macro_export]
macro_rules! generate_temp_attachment_s3_key {
    ($link_id:expr, $attachment_id:expr, $filename:expr) => {
        format!(
            "temp/{}/{}-{}",
            $link_id,
            $attachment_id,
            $filename.clone().unwrap_or_default()
        )
    };
}
