use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sqlx::PgPool;

use model::authentication::permission::Permission;

/// Gets all permissions
#[utoipa::path(
        get,
        path = "/permissions",
        operation_id = "get_permissions",
        responses(
            (status = 200, body=Vec<Permission>),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db))]
pub async fn handler(State(db): State<PgPool>) -> Result<Response, Response> {
    let permissions = macro_db_client::user::permissions::get_all_permissions(&db)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get permissions");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get permissions".to_string(),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(permissions)).into_response())
}
