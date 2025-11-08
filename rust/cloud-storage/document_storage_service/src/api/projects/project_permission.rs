use crate::api::context::ApiContext;
use axum::extract::State;
use axum::response::Response;
use axum::{
    Extension,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use macro_middleware::cloud_storage::ensure_access::project::ProjectAccessLevelExtractor;
use model::response::GenericErrorResponse;
use model::user::UserContext;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::{AccessLevel, OwnerAccessLevel};

#[derive(serde::Deserialize)]
pub struct Params {
    pub id: String,
}

/// Gets the current documents share permissions
/// Gets the projects share permissions
#[utoipa::path(
        tag = "project",
        get,
        path = "/projects/{id}/permissions",
        operation_id = "get_project_permissions_v2",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=SharePermissionV2),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, id), fields(user_id=?user_context.user_id, project_id=?id))]
pub async fn get_project_permissions_handler(
    State(ctx): State<ApiContext>,
    access: ProjectAccessLevelExtractor<OwnerAccessLevel>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
) -> Result<Response, Response> {
    get_project_permission_v2(&ctx.db, &id).await
}

async fn get_project_permission_v2(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
) -> Result<Response, Response> {
    let project_permissions = macro_db_client::share_permission::get::get_project_share_permission(
        db, project_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, project_id=?project_id, "unable to get project permissions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericErrorResponse {
                error: true,
                message: "unable to get project permissions".to_string(),
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(project_permissions)).into_response())
}

/// Gets the user's access level to the project
#[utoipa::path(
        tag = "project",
        get,
        path = "/projects/{id}/access_level",
        operation_id = "get_project_user_access_level",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=AccessLevel),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_project_access_level_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
) -> impl IntoResponse {
    let user_access_level: Option<AccessLevel> =
        match macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
            &ctx.db,
            &ctx.comms_service_client,
            &user_context.user_id,
            &id,
            "project",
        )
        .await
        {
            Ok(user_access_level) => user_access_level,
            Err(e) => {
                tracing::error!(error=?e, "failed to get user access level");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(GenericErrorResponse {
                        error: true,
                        message: "failed to get user access level".to_string(),
                    }),
                )
                    .into_response();
            }
        };

    let user_access_level = if let Some(user_access_level) = user_access_level {
        user_access_level
    } else {
        tracing::warn!("user does not have access to project");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericErrorResponse {
                error: true,
                message: "user does not have access to project".to_string(),
            }),
        )
            .into_response();
    };

    (StatusCode::OK, Json(user_access_level)).into_response()
}
