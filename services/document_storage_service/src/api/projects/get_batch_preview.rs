use std::collections::HashSet;

use crate::api::context::ApiContext;
use anyhow::Result;
use axum::{
    Extension,
    extract::{Json, State},
    response::{IntoResponse, Response},
};
use model::{
    project::{
        ProjectPreview, ProjectPreviewData, ProjectPreviewV2, WithProjectId,
        request::GetBatchProjectPreviewRequest, response::GetBatchProjectPreviewResponse,
    },
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};
use reqwest::StatusCode;

#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=?user_context.user_id))]
#[utoipa::path(
    tag = "project",
    post,
    path = "/projects/preview",
    responses(
        (status = 200, body=GetBatchProjectPreviewResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    ),
    operation_id = "get_batch_project_preview"
)]
pub async fn get_batch_preview_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<GetBatchProjectPreviewRequest>,
) -> Result<(StatusCode, Json<GetBatchProjectPreviewResponse>), Response> {
    // Ensure the project ids are unique to prevent duplicate work
    let unique_project_ids: HashSet<String> = req.project_ids.iter().cloned().collect();
    let project_ids: Vec<String> = unique_project_ids.into_iter().collect();

    let project_preview_results =
        macro_db_client::projects::preview::batch_get_project_preview_v2(&ctx.db, &project_ids)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "unable to get project preview");
                GenericResponse::builder()
                    .message("failed to retrieve project previews")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR)
                    .into_response()
            })?;

    let result: Vec<ProjectPreview> = project_preview_results
        .iter()
        .map(|p| match p {
            ProjectPreviewV2::Found(data) => ProjectPreview::Access(ProjectPreviewData {
                id: data.id.clone(),
                name: data.name.clone(),
                owner: data.owner.clone(),
                path: data.path.clone(),
                updated_at: data.updated_at,
            }),
            ProjectPreviewV2::DoesNotExist(data) => ProjectPreview::DoesNotExist(WithProjectId {
                id: data.id.clone(),
            }),
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(GetBatchProjectPreviewResponse { previews: result }),
    ))
}
