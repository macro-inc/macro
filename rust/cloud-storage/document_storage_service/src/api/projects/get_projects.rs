use crate::api::context::ApiContext;

use axum::extract::State;
use futures::stream::{FuturesUnordered, StreamExt};

use axum::{Extension, http::StatusCode, response::IntoResponse};
use model::project::PendingProject;
use model::project::response::GetProjectsResponse;
use model::response::{GenericErrorResponse, GenericResponse, TypedSuccessResponse};
use model::user::UserContext;
use models_bulk_upload::ProjectDocumentStatus;

type PendingProjectsResponse = TypedSuccessResponse<Vec<PendingProject>>;

/// Gets all the users projects. This includes projects shared with the user.
#[utoipa::path(
        tag = "project",
        get,
        path = "/projects",
        responses(
            (status = 200, body=GetProjectsResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_projects_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    tracing::trace!("get_projects_handler");
    let projects = match macro_db_client::projects::get_projects(
        ctx.db.clone(),
        &user_context.user_id,
    )
    .await
    {
        Ok(projects) => projects,
        Err(e) => {
            tracing::error!(error=?e, "error getting projects");
            return GenericResponse::builder()
                .message("unable to get projects")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    GenericResponse::builder()
        .data(&projects)
        .send(StatusCode::OK)
}

/// Gets all the users projects that are pending upload. This includes projects shared with the user.
#[utoipa::path(
        tag = "project",
        get,
        path = "/projects/pending",
        responses(
            (status = 200, body=inline(PendingProjectsResponse)),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_pending_projects_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    tracing::trace!("get_pending_projects_handler");
    let projects = match macro_db_client::projects::get_pending_root_projects(
        ctx.db.clone(),
        &user_context.user_id,
    )
    .await
    {
        Ok(projects) => projects,
        Err(e) => {
            tracing::error!(error=?e, "error getting projects");
            return GenericResponse::builder()
                .message("unable to get projects")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let mut futures = FuturesUnordered::new();

    for pending_project in projects {
        let project = pending_project.project;

        // only build status for root projects
        if project.parent_id.is_some() {
            tracing::warn!("Skipping pending project with parent_id: {}", project.id);
            continue;
        }

        let dynamodb_client = ctx.dynamodb_client.clone();
        let upload_request_id = pending_project.upload_request_id;
        futures.push(async move {
            let result: anyhow::Result<PendingProject> = if let Some(upload_request_id) = upload_request_id {
                let document_statuses: Vec<ProjectDocumentStatus> = match dynamodb_client
                    .bulk_upload
                    .get_bulk_upload_document_statuses(&upload_request_id)
                    .await {
                        Ok(status_result) => {
                        if status_result.documents.is_empty() {
                            tracing::warn!("No documents found for upload request {}", upload_request_id);
                        } else if status_result.root_project_id != project.id {
                            anyhow::bail!("Root project ID mismatch for upload request {}. DynamoDB project {}. Provided project {}", upload_request_id, status_result.root_project_id, project.id);
                        }

                        status_result.documents
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "Error getting document statuses for project {}", project.id);
                            vec![]
                        }
                    };

                Ok(PendingProject {
                    project,
                    document_statuses
                })
            } else {
                tracing::warn!("No upload request found for project {}", project.id);
                Ok(PendingProject {
                    project,
                    document_statuses: vec![],
                })
            };

            result
        });
    }

    let mut projects: Vec<PendingProject> = Vec::new();
    while let Some(res) = futures.next().await {
        match res {
            Ok(project) => projects.push(project),
            Err(e) => {
                tracing::error!(error=?e, "Error getting pending project info");
            }
        }
    }

    GenericResponse::builder()
        .data(&projects)
        .send(StatusCode::OK)
}
