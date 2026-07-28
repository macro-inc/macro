use crate::api::context::{ApiContext, AuthorizationService};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::GenericResponse;
use model::thread::response::GetThreadUserAccessLevelResponse;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub thread_id: String,
}
#[tracing::instrument(skip(ctx, user), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { thread_id }): Path<Params>,
) -> impl IntoResponse {
    let user_access_level: Option<AccessLevel> = match ctx
        .entity_access_service
        .get_access_level(
            Some(&user.authorization.user.macro_user_id),
            &thread_id,
            EntityType::EmailThread,
        )
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
