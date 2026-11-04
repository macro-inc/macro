use axum::{Json, extract::State, http::StatusCode};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::user::update_profile_picture::update_profile_picture;
use model::response::{EmptyResponse, ErrorResponse};
use models_sfs::FileMetadata;

use crate::api::context::{ApiContext, AuthorizationService};

#[cfg(test)]
mod test;

/// Image types browsers render as a profile picture. SVG is excluded: it can
/// carry scripts and external references.
const PROFILE_PICTURE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

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
        (status = 400, body = ErrorResponse, description = "Not a supported image type"),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(
    skip_all,
    fields(user_id = %authorization.authorization.user.macro_user_id),
)]
pub async fn create_upload_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<CreateProfilePictureUploadRequest>,
) -> Result<Json<ProfilePictureUpload>, (StatusCode, Json<ErrorResponse<'static>>)> {
    if !PROFILE_PICTURE_TYPES.contains(&req.content_type.as_str()) {
        return Err(error(StatusCode::BAD_REQUEST, "not a supported image type"));
    }

    let reserved = ctx
        .static_file_service_client
        .reserve_for_user(
            authorization.authorization.user.macro_user_id.as_ref(),
            &req.file_name,
            &req.content_type,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to reserve profile picture upload");
            error(StatusCode::INTERNAL_SERVER_ERROR, "unable to start upload")
        })?;

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
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(
    skip_all,
    fields(user_id = %authorization.authorization.user.macro_user_id, file_id = %req.file_id),
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<PutProfilePictureFileRequest>,
) -> Result<Json<EmptyResponse>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let file_id = uuid::Uuid::parse_str(&req.file_id)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid file id"))?;

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

    Ok(Json(EmptyResponse {}))
}
