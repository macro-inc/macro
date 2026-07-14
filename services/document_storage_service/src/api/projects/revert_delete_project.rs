use crate::api::context::ApiContext;
use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
#[allow(unused_imports)]
use futures::stream::TryStreamExt;
use model::project::BasicProject;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
use sqs_client::search::{SearchQueueMessage, project::UpsertProject};

#[derive(serde::Deserialize)]
pub struct Params {
    pub id: String,
}

/// Deletes a specific document
#[utoipa::path(
        tag = "project",
        put,
        operation_id = "revert_delete_project",
        path = "/projects/{id}/revert_delete",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, project_context, id), fields(user_id=?user_context.user_id, project_id=?id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
    project_context: Extension<BasicProject>,
) -> impl IntoResponse {
    tracing::info!("revert_delete project");

    let project_ids = match macro_db_client::projects::revert_delete::revert_delete_project(
        &ctx.db,
        &id,
        project_context.parent_id.as_deref(),
    )
    .await
    {
        Ok(project_ids) => project_ids,
        Err(e) => {
            tracing::error!(error=?e, "unable to revert project");
            return GenericResponse::builder()
                .message("unable to revert project")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if !project_ids.is_empty() {
        tokio::spawn({
            let sqs_client = ctx.sqs_client.clone();
            async move {
                let _ = sqs_client
                    .bulk_send_message_to_search_event_queue(
                        project_ids
                            .iter()
                            .map(|id| {
                                SearchQueueMessage::UpsertProject(UpsertProject {
                                    project_id: id.to_string(),
                                    index_override: None,
                                })
                            })
                            .collect(),
                    )
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, "unable to enqueue restored projects for search"),
                    );
            }
        });
    }

    let data = GenericSuccessResponse::default();

    GenericResponse::builder().data(&data).send(StatusCode::OK)
}
