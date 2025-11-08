use crate::api::context::ApiContext;
use anyhow::Context;
use axum::{
    Extension,
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::project::{
    ProjectAccessLevelExtractor, ProjectBodyAccessLevelExtractor,
};
use macro_share_permissions::user_item_access::update_user_item_access;
use model::response::{GenericErrorResponse, SuccessResponse};
use model::{project::BasicProject, response::GenericSuccessResponse};
use model::{project::request::PatchProjectRequestV2, response::ErrorResponse, user::UserContext};
use models_permissions::share_permission::access_level::{AccessLevel, EditAccessLevel};
use sqs_client::search::{SearchQueueMessage, project};
use tracing::Instrument;

#[derive(serde::Deserialize)]
pub struct Params {
    pub id: String,
}

/// Edits a project.
#[utoipa::path(
        tag = "project",
        patch,
        operation_id = "edit_project_v2",
        path = "/v2/projects/{id}",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[allow(unused, reason = "used to generate OpenAPI documentation")]
pub async fn edit_project_handler_v2(
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
    Json(req): Json<PatchProjectRequestV2>,
) -> impl IntoResponse {
    StatusCode::OK
}

/// Edits a project.
#[tracing::instrument(skip(ctx, user_context, project, id), fields(user_id=?user_context.user_id, project_id=?id))]
pub async fn edit_project_handler(
    ProjectAccessLevelExtractor { access_level, .. }: ProjectAccessLevelExtractor<EditAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    project_context: Extension<BasicProject>,
    Path(Params { id }): Path<Params>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, PatchProjectRequestV2>,
) -> Result<Response, Response> {
    let req = project.into_inner();

    if project_context.deleted_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot modify deleted project",
            }),
        )
            .into_response());
    }

    edit_project_v2(&ctx, user_context, project_context, access_level, id, req)
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

    return Ok((
        StatusCode::OK,
        Json(SuccessResponse {
            error: false,
            data: GenericSuccessResponse::default(),
        }),
    )
        .into_response());
}

async fn edit_project_v2(
    ctx: &ApiContext,
    user_context: Extension<UserContext>,
    project_context: Extension<BasicProject>,
    users_access_level: AccessLevel,
    id: String,
    req: PatchProjectRequestV2,
) -> Result<(), (StatusCode, String)> {
    // Need to ensure we are not nesting the project
    if let Some(project_parent_id) = req.project_parent_id.as_ref() {
        if users_access_level != AccessLevel::Owner {
            return Err((
                StatusCode::UNAUTHORIZED,
                "you do not have valid permissions to move this item".to_string(),
            ));
        }

        if project_parent_id == &id {
            tracing::warn!("project parent id matches project id");
            return Err((
                StatusCode::BAD_REQUEST,
                "project parent id matches project id".to_string(),
            ));
        }
        match macro_db_client::projects::nested_projects::is_project_recursively_nested(
            ctx.db.clone(),
            id.as_str(),
            project_parent_id.as_str(),
        )
        .await
        {
            Ok(e) => {
                if e.is_some() {
                    tracing::warn!(error=?e, "project is recursively nested");
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "project is recursively nested".to_string(),
                    ));
                }
            }
            Err(e) => {
                tracing::error!(error=?e, "unable to check if project is recursively nested");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "error checking if project is recursively nested".to_string(),
                ));
            }
        };
    }

    if req.share_permission.is_some() && users_access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            "you do not have valid permission to modify share permissions".to_string(),
        ));
    }

    if let Err(err) = patch_project_transaction(
        ctx,
        &user_context,
        &id,
        &project_context,
        req.name.as_deref(),
        req.project_parent_id.as_deref(),
        req.share_permission.as_ref(),
    )
    .await
    {
        tracing::error!(error=?err, "Failed to patch project");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to patch project".to_string(),
        ));
    }

    // Update the project you are editting
    macro_project_utils::update_project_modified(
        &ctx.db,
        &ctx.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id: Some(id.clone()), // The project you edited
            old_project_id: None,
            user_id: user_context.user_id.clone(),
        },
    )
    .await;

    // Update the project you moved from and moved to
    macro_project_utils::update_project_modified(
        &ctx.db,
        &ctx.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id: req.project_parent_id, // The new project you've placed your item in
            old_project_id: project_context.parent_id.clone(), // The old project you've moved your item from
            user_id: user_context.user_id.clone(),
        },
    )
    .await;

    // Update search index if name changes
    if req.name.is_some() {
        tokio::spawn({
            let sqs_client = ctx.sqs_client.clone();
            let project_id = id.clone();
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
    }

    Ok(())
}

#[tracing::instrument(skip(ctx, user_context))]
async fn patch_project_transaction(
    ctx: &ApiContext,
    user_context: &UserContext,
    project_id: &str,
    project_context: &BasicProject,
    name: Option<&str>,
    project_parent_id: Option<&str>,
    share_permission: Option<&models_permissions::share_permission::UpdateSharePermissionRequestV2>,
) -> anyhow::Result<()> {
    let mut transaction = ctx
        .db
        .begin()
        .await
        .context("failed to begin transaction")?;

    // Update project metadata
    macro_db_client::projects::edit_project_v2(
        &mut transaction,
        &user_context.user_id,
        project_id,
        name,
        project_parent_id,
        share_permission,
    )
    .await
    .context("failed to patch project")?;

    // Update user access if share permissions are provided
    if let Some(share_permission) = share_permission {
        update_user_item_access(
            &mut transaction,
            &ctx.comms_service_client,
            &user_context.user_id,
            &project_context.id,
            "project",
            share_permission,
        )
        .await
        .context("failed to update user item access")?;
    }

    transaction
        .commit()
        .await
        .context("failed to commit transaction")?;

    Ok(())
}
