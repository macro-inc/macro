use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{Extension, Json};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::GenericResponse;
use model::thread::response::GetThreadUserAccessLevelResponse;
use model::user::UserContext;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub thread_id: String,
}
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { thread_id }): Path<Params>,
) -> impl IntoResponse {
    let user_id = match MacroUserIdStr::parse_from_str(&user_context.user_id) {
        Ok(user_id) => user_id,
        Err(e) => {
            tracing::error!(error=?e, "failed to parse user id");
            return GenericResponse::builder()
                .message("failed to get user access level")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let user_access_level: Option<AccessLevel> = match ctx
        .entity_access_service
        .get_access_level(Some(&user_id), &thread_id, EntityType::EmailThread)
        .await
    {
        Ok(user_access_level) => user_access_level,
        Err(e) => {
            tracing::error!(error=?e, "failed to get user access level");
            return GenericResponse::builder()
                .message("failed to get user access level")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let user_access_level = if let Some(user_access_level) = user_access_level {
        user_access_level
    } else {
        tracing::warn!("user does not have access to thread");
        return GenericResponse::builder()
            .message("user does not have access to thread")
            .is_error(true)
            .send(StatusCode::UNAUTHORIZED);
    };

    (
        StatusCode::OK,
        Json(GetThreadUserAccessLevelResponse { user_access_level }),
    )
        .into_response()
}
