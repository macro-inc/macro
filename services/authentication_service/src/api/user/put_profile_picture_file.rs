use axum::{Json, extract::State, http::StatusCode};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::user::update_profile_picture::update_profile_picture;
use model::response::{EmptyResponse, ErrorResponse};
use models_sfs::FileMetadata;

use rate_limit::domain::{
    models::{RateLimitConfig, RateLimitKey},
    ports::RateLimitService,
};

use super::profile_picture_change::{
    picture_changed_metadata, publish_picture_changed, throttle_set,
};
use crate::api::{
    context::{ApiContext, AuthorizationService},
    middleware::rate_limit::RATE_LIMIT_ENABLED,
};

#[cfg(test)]
mod test;

/// Image types browsers render as a profile picture. SVG is excluded: it can
/// carry scripts and external references.
const PROFILE_PICTURE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/// The largest profile picture, matching the web app's limit.
const MAX_PROFILE_PICTURE_BYTES: u64 = 16 * 1000 * 1000;

/// Uploads one user may start per hour. Pictures rarely change, so this only
/// stops a key from filling storage.
const PROFILE_PICTURE_UPLOADS_PER_HOUR: u64 = 20;

#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct PutProfilePictureFileRequest {
    /// Id of an image the caller uploaded to static file storage.
    pub file_id: String,
}

/// Why a stored file cannot be a caller's profile picture. An upload is marked
/// complete by an asynchronous storage event, so it is not checked here: setting
/// the picture right after uploading must work, as it does in the web app.
#[derive(Debug, PartialEq, Eq)]
enum ProfilePictureFileError {
    NotOwner,
    NotAnImage,
}

fn validate_profile_picture_file(
    metadata: &FileMetadata,
    caller_id: &str,
) -> Result<(), ProfilePictureFileError> {
    if metadata.owner_id != caller_id {
        return Err(ProfilePictureFileError::NotOwner);
    }
    if !PROFILE_PICTURE_TYPES.contains(&metadata.content_type.as_str()) {
        return Err(ProfilePictureFileError::NotAnImage);
    }

    Ok(())
}

fn error(status: StatusCode, message: &str) -> (StatusCode, Json<ErrorResponse<'static>>) {
    (
        status,
        Json(ErrorResponse {
            message: message.to_string().into(),
        }),
    )
}

/// Where to upload a new profile picture, and the file id to set afterwards.
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ProfilePictureUpload {
    /// Id to pass to `PUT /user/profile_picture/file` once uploaded.
    pub file_id: String,
    /// Expiring URL to `PUT` the image bytes to.
    pub upload_url: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct CreateProfilePictureUploadRequest {
    /// File name, such as `avatar.png`.
    pub file_name: String,
    /// Mime type of the image.
    pub content_type: String,
    /// Exact size of the image in bytes. Storage rejects a body of any other size.
    pub size_bytes: u64,
}

/// Why an upload cannot be reserved.
#[derive(Debug, PartialEq, Eq)]
enum ProfilePictureUploadError {
    UnsupportedType,
    Empty,
    TooLarge,
}

fn validate_profile_picture_upload(
    content_type: &str,
    size_bytes: u64,
) -> Result<(), ProfilePictureUploadError> {
    if !PROFILE_PICTURE_TYPES.contains(&content_type) {
        return Err(ProfilePictureUploadError::UnsupportedType);
    }
    if size_bytes == 0 {
        return Err(ProfilePictureUploadError::Empty);
    }
    if size_bytes > MAX_PROFILE_PICTURE_BYTES {
        return Err(ProfilePictureUploadError::TooLarge);
    }

    Ok(())
}

/// Reserves storage for a new profile picture. Static file storage has no
/// MacroDB, so it cannot check API keys; this route lets key holders upload.
#[utoipa::path(
    post,
    path = "/user/profile_picture/file",
    operation_id = "create_profile_picture_upload",
    request_body = CreateProfilePictureUploadRequest,
    responses(
        (status = 200, body = ProfilePictureUpload),
        (status = 400, body = ErrorResponse, description = "Not a supported image type, or empty"),
        (status = 401, body = String),
        (status = 413, body = ErrorResponse, description = "The image is larger than 16 MB"),
        (status = 429, body = ErrorResponse, description = "Too many uploads this hour"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(
    skip_all,
    fields(
        user_id = %authorization.authorization.user.macro_user_id,
        size_bytes = req.size_bytes,
        rate_limited = tracing::field::Empty,
    ),
)]
pub async fn create_upload_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<CreateProfilePictureUploadRequest>,
) -> Result<Json<ProfilePictureUpload>, (StatusCode, Json<ErrorResponse<'static>>)> {
    validate_profile_picture_upload(&req.content_type, req.size_bytes).map_err(|e| match e {
        ProfilePictureUploadError::UnsupportedType => {
            error(StatusCode::BAD_REQUEST, "not a supported image type")
        }
        ProfilePictureUploadError::Empty => error(StatusCode::BAD_REQUEST, "the image is empty"),
        ProfilePictureUploadError::TooLarge => error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "profile pictures can be at most 16 MB",
        ),
    })?;

    let user_id = authorization.authorization.user.macro_user_id.as_ref();

    let ticket = if RATE_LIMIT_ENABLED {
        let key = RateLimitKey::builder(&"profile-picture-upload")
            .append(&user_id)
            .finish();
        let config = RateLimitConfig::new(
            PROFILE_PICTURE_UPLOADS_PER_HOUR,
            std::time::Duration::from_secs(60 * 60),
        );
        let result = ctx
            .rate_limit_service
            .check_rate_limit(key, config)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to check profile picture rate limit");
                error(StatusCode::INTERNAL_SERVER_ERROR, "unable to start upload")
            })?;
        tracing::Span::current().record("rate_limited", result.is_err());
        let ticket = result.map_err(|_| {
            error(
                StatusCode::TOO_MANY_REQUESTS,
                "too many profile picture uploads, try again later",
            )
        })?;
        Some(ticket)
    } else {
        None
    };

    let reserved = ctx
        .static_file_service_client
        .reserve_sized_for_user(user_id, &req.file_name, &req.content_type, req.size_bytes)
        .await;
    let reserved = match reserved {
        Ok(reserved) => reserved,
        Err(e) => {
            tracing::error!(error=?e, "unable to reserve profile picture upload");
            if let Some(ticket) = ticket {
                // Our failure should not spend the caller's allowance.
                let _ = ctx
                    .rate_limit_service
                    .rollback_ticket(ticket)
                    .await
                    .inspect_err(|e| tracing::warn!(error=?e, "unable to roll back rate limit"));
            }
            return Err(error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to start upload",
            ));
        }
    };

    Ok(Json(ProfilePictureUpload {
        file_id: reserved.id,
        upload_url: reserved.upload_url,
    }))
}

/// Sets the caller's profile picture to an image they uploaded.
#[utoipa::path(
    put,
    path = "/user/profile_picture/file",
    operation_id = "put_profile_picture_file",
    request_body = PutProfilePictureFileRequest,
    responses(
        (status = 200, body = EmptyResponse),
        (status = 400, body = ErrorResponse, description = "The file is not a supported image"),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse, description = "The caller has no such file"),
        (status = 429, body = ErrorResponse, description = "Picture changed less than a second ago"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(
    skip_all,
    fields(
        user_id = %authorization.authorization.user.macro_user_id,
        file_id = %req.file_id,
        rate_limited = tracing::field::Empty,
    ),
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<PutProfilePictureFileRequest>,
) -> Result<Json<EmptyResponse>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let file_id = uuid::Uuid::parse_str(&req.file_id)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid file id"))?;

    throttle_set(
        &ctx,
        authorization.authorization.user.macro_user_id.as_ref(),
    )
    .await?;

    let metadata = ctx
        .static_file_service_client
        .get_file_metadata(&file_id.to_string())
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to read file metadata");
            error(StatusCode::INTERNAL_SERVER_ERROR, "unable to read file")
        })?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "file not found"))?;

    let caller_id = authorization.authorization.user.macro_user_id.as_ref();
    validate_profile_picture_file(&metadata, caller_id).map_err(|e| match e {
        // Someone else's file answers like a missing one.
        ProfilePictureFileError::NotOwner => error(StatusCode::NOT_FOUND, "file not found"),
        ProfilePictureFileError::NotAnImage => {
            error(StatusCode::BAD_REQUEST, "file is not a supported image")
        }
    })?;

    let url = format!(
        "{}/file/{}",
        ctx.static_file_public_url.trim_end_matches('/'),
        file_id
    );
    update_profile_picture(
        &ctx.db,
        &authorization.authorization.user.user_context.fusion_user_id,
        &url,
        "000",
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to update profile picture");
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to update profile picture",
        )
    })?;

    publish_picture_changed(
        &ctx,
        picture_changed_metadata(
            authorization.authorization.user.macro_user_id.clone(),
            Some(file_id.to_string()),
            &url,
        ),
    );

    Ok(Json(EmptyResponse {}))
}
