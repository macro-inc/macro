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

    if let Err(e) = macro_db_client::projects::revert_delete::revert_delete_project(
        &ctx.db,
        &id,
        project_context.parent_id.as_deref(),
    )
    .await
    {
        tracing::error!(error=?e, "unable to revert project");
        return GenericResponse::builder()
            .message("unable to revert project")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let data = GenericSuccessResponse::default();

    GenericResponse::builder().data(&data).send(StatusCode::OK)
}
