use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use macro_db_client::user::update_profile_picture::update_profile_picture;
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use serde::Deserialize;

#[derive(Deserialize, Debug, utoipa::IntoParams)]
pub struct ProfilePictureQueryParams {
    /// profile picture URL
    url: String,
}

/// Sets the profile picture URL for a particular user
#[utoipa::path(
        put,
        path = "/user/profile_picture",
        operation_id = "put_profile_picture",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
        params(ProfilePictureQueryParams),
    )]
#[tracing::instrument(skip(ctx, user_context))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Query(params): Query<ProfilePictureQueryParams>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    update_profile_picture(
        &ctx.db,
        &user_context.fusion_user_id,
        &params.url,
        "000",
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, user_context.user_id, "failed to update user profile picture");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;
    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
