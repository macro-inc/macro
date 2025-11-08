use crate::api::context::ApiContext;
use axum::{
    Extension,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_middleware::cloud_storage::ensure_access::project::ProjectBodyAccessLevelExtractor;
use model::{
    project::{Project, request::CreateProjectRequest, response::CreateProjectResponse},
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};
use models_permissions::share_permission::access_level::EditAccessLevel;
use sqs_client::search::{SearchQueueMessage, project};
use tracing::Instrument;

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
#[tracing::instrument(skip(ctx, user_context, project), fields(user_id=?user_context.user_id))]
pub async fn create_project_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateProjectRequest>,
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
    user_context: Extension<UserContext>,
    req: CreateProjectRequest,
) -> Result<Project, (StatusCode, String)> {
    let share_permission =
        macro_share_permissions::share_permission::create_new_project_share_permission();

    let project = match macro_db_client::projects::create_project_v2(
        ctx.db.clone(),
        &user_context.user_id,
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
            &ctx.macro_notify_client,
            macro_project_utils::ProjectModifiedArgs {
                project_id: None,
                old_project_id: Some(project_id.to_string()),
                user_id: user_context.user_id.clone(),
            },
        )
        .await;
    }

    // Add project to search index
    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        let project_id = project.id.clone();
        let macro_user_id = user_context.user_id.clone();
        async move {
            tracing::trace!("sending message to search extractor queue");
            let _ = sqs_client
                .send_message_to_search_event_queue(SearchQueueMessage::ProjectMessage(
                    project::ProjectMessage {
                        project_id,
                        macro_user_id,
                    },
                ))
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                });
        }
        .in_current_span()
    });

    Ok(project)
}
