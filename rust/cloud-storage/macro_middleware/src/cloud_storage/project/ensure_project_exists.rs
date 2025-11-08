use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use serde::Deserialize;
use sqlx::{PgPool, Pool, Postgres};

use model::project::BasicProject;

use crate::error_handler::error_handler;

#[derive(Deserialize)]
pub struct Params {
    pub id: String,
}

/// Finds the requested project and returns the basic project information to be used in the
/// request context
#[tracing::instrument(skip(db))]
async fn get_basic_project(
    db: &Pool<Postgres>,
    project_id: &str,
) -> Result<BasicProject, (StatusCode, String)> {
    let result: BasicProject =
        macro_db_client::projects::get_project::get_basic_project::get_basic_project(
            db, project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get project");
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                return (
                    StatusCode::NOT_FOUND,
                    format!("project with id \"{}\" was not found", project_id),
                );
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unknown error occurred".to_string(),
            )
        })?;

    Ok(result)
}

/// Validates the document exists and inserts DocumentBasic into req context
pub async fn handler(
    State(db): State<PgPool>,
    Path(Params { id }): Path<Params>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let project = get_basic_project(&db, &id)
        .await
        .map_err(|(status_code, msg)| error_handler(&msg, status_code))?;

    req.extensions_mut().insert(project);
    Ok(next.run(req).await)
}
