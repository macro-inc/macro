use crate::api::context::ApiContext;
use crate::api::context::EntityAccessService;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractor;
use model::{
    project::{Project, request::CreateProjectRequest, response::CreateProjectResponse},
    response::{GenericErrorResponse, GenericResponse},
    user::axum_extractor::MacroUserExtractor,
};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::EditAccessLevel;
use unicode_segmentation::UnicodeSegmentation;

/// Creates a new project.
/// The project can be created as a sub-project of another project or as a top-level project.
#[utoipa::path(
        tag = "project",
        post,
        path = "/projects",
        request_body = CreateProjectRequest,
        responses(
            (status = 200, body=CreateProjectResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_project_handler(
    State(ctx): State<ApiContext>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<
        EditAccessLevel,
        CreateProjectRequest,
        EntityAccessService,
    >,
) -> Result<Response, Response> {
    let req = project.into_inner();

    let project =
        create_project_v2(ctx, user_context, req)
            .await
            .map_err(|(status_code, message)| {
                tracing::error!(error=?message, "unable to create project");
                (
                    status_code,
                    Json(GenericErrorResponse {
                        error: true,
                        message,
                    }),
                )
                    .into_response()
            })?;

    Ok(GenericResponse::builder()
        .data(&project)
        .send(StatusCode::OK))
}

async fn create_project_v2(
    ctx: ApiContext,
    user_context: MacroUserExtractor,
    req: CreateProjectRequest,
) -> Result<Project, (StatusCode, String)> {
    if req.name.graphemes(true).count() > 100 {
        return Err((StatusCode::BAD_REQUEST, "name too long".to_string()));
    }

    let share_permission = SharePermissionV2::new_project_share_permission();

    let project = match macro_db_client::projects::create_project_v2(
        ctx.db.clone(),
        user_context.macro_user_id.clone(),
        &req.name,
        req.project_parent_id.clone(),
        &share_permission,
    )
    .await
    {
        Ok(project) => project,
        Err(e) => {
            tracing::error!(error=?e, "unable to create project");
            return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
        }
    };

    // update project modified if necessary
    if let Some(project_id) = req.project_parent_id {
        tracing::trace!("updating project modified date");
        macro_project_utils::update_project_modified(
            &ctx.db,
            macro_project_utils::ProjectModifiedArgs {
                project_id: None,
                old_project_id: Some(project_id.to_string()),
                user_id: user_context.user_context.user_id.clone(),
            },
        )
        .await;
    }

    Ok(project)
}
