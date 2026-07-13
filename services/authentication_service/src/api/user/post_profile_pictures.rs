use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use macro_db_client::user::update_profile_picture::get_profile_pictures;
use model::response::ErrorResponse;
use model::user::ProfilePictures;
use utoipa::ToSchema;

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetProfilePicturesRequestBody {
    pub user_id_list: Vec<String>,
}

/// Retrieves profile picture URLs for a list of users
#[utoipa::path(
        post,
        path = "/user/profile_pictures",
        operation_id = "post_profile_pictures",
        responses(
            (status = 200, body=ProfilePictures),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<GetProfilePicturesRequestBody>,
) -> Result<Response, Response> {
    let user_id_list = req.user_id_list;
    let db = &ctx.db;
    let result = get_profile_pictures(db, &user_id_list).await.map_err(|e| {
        tracing::error!(error=?e, "failed to get profile pictures");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;
    let pictures = result.pictures;
    Ok((StatusCode::OK, Json(ProfilePictures { pictures })).into_response())
}
