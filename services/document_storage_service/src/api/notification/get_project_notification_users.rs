use axum::Json;
use axum::extract::State;
use axum::response::Response;
use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use model::response::GenericErrorResponse;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub project_id: String,
}

/// Gets all users that need to be notified for a project
/// Returns an list of strings that are the user ids to be notified
#[utoipa::path(
        get,
        path = "/internal/notifications/project/{project_id}",
        operation_id = "get_project_notification_users",
        params(
            ("project_id" = String, Path, description = "Project ID")
        ),
        responses(
            (status = 200, body=Vec<String>),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db))]
pub async fn handler(
    State(db): State<PgPool>,
    Path(Params { project_id }): Path<Params>,
) -> Result<Response, Response> {
    let users =
        macro_db_client::notification::project::get_project_notification_users(&db, &project_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get project notification users");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(GenericErrorResponse {
                        error: true,
                        message: "unable to get project notification users".to_string(),
                    }),
                )
                    .into_response()
            })?;

    Ok((StatusCode::OK, Json(users)).into_response())
}
