use crate::api::context::ApiContext;
use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
};
use macro_db_client::user::get_user_name::get_user_names_with_email;
use macro_user_id::user_id::MacroUserId;
use macro_user_id::{cowlike::CowLike, lowercased::Lowercase};

use model::response::ErrorResponse;
use model::user::{UserContext, UserNames};
use non_empty::NonEmpty;

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct GetNamesWithEmailRequestBody {
    pub user_ids: Vec<String>,
}

/// Gets names for passed user profile ids, falling back to the requesting user's email contact names
#[utoipa::path(
    post,
    path = "/user/get_names_with_email",
    operation_id = "get_user_names_with_email",
    responses(
            (status = 200, body=UserNames),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
    ),
)]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<GetNamesWithEmailRequestBody>,
) -> Result<Json<UserNames>, (StatusCode, String)> {
    let user_profile_ids: NonEmpty<Vec<MacroUserId<Lowercase>>> = NonEmpty::new(
        req.user_ids
            .into_iter()
            .filter_map(|id| {
                MacroUserId::parse_from_str(&id)
                    .map(|i| i.into_owned().lowercase())
                    .ok()
            })
            .collect(),
    )
    .map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "user_ids cannot be empty".to_string(),
        )
    })?;

    let user_names = get_user_names_with_email(&ctx.db, &user_context.user_id, user_profile_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user names with email");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    Ok(Json(UserNames { names: user_names }))
}
