use crate::api::context::ApiContext;

use axum::Json;
use axum::extract::State;
use axum::response::Response;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::project::ProjectAccessLevelExtractor;
use model::project::response::{
    GetProjectContentResponse, GetProjectResponse, GetProjectResponseData,
};
use model::response::{ErrorResponse, GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub id: String,
}

/// Gets the content of a project.
/// This includes the projects sub-projects as well as the items in the project.
#[utoipa::path(
        tag = "project",
        get,
        path = "/projects/{id}/content",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=GetProjectContentResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context, id), fields(user_id=?user_context.user_id, project_id=?id))]
pub async fn get_project_content_handler(
    ProjectAccessLevelExtractor { access_level, .. }: ProjectAccessLevelExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
) -> Result<Response, Response> {
    let content = macro_db_client::projects::get_project::get_project_content_v2(
        &db,
        id.as_str(),
        user_context.user_id.as_str(),
        access_level,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get project content");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to get project content",
            }),
        )
            .into_response()
    })?;

    Ok(GenericResponse::builder()
        .data(&content)
        .send(StatusCode::OK))
}

#[utoipa::path(
    get,
    path = "/projects/{id}",
    params(
        ("id" = String, Path, description = "ID of the project")
    ),
    responses(
        (status = 200, body=GetProjectResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, id), fields(user_id=?user_context.user_id, project_id=?id))]
pub async fn get_project_handler(
    ProjectAccessLevelExtractor { access_level, .. }: ProjectAccessLevelExtractor<ViewAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
) -> Result<Response, Response> {
    let project_metadata =
        macro_db_client::projects::get_project::get_project_by_id(ctx.db.clone(), id.as_str())
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get project");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get project",
                    }),
                )
                    .into_response()
            })?;

    let response_data = GetProjectResponseData {
        project_metadata,
        user_access_level: access_level,
    };

    Ok(GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK))
}
