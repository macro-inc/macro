use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;

use crate::api::context::ApiContext;

use macro_db_client::user::update_user_name::update_user_name;

use model::{authentication::webhooks::update_name::UpdateNameWebhook, response::EmptyResponse};

use sqlx::{Pool, Postgres};

// Code's not really dead, but the Rust LSP can't seem to see that I'm calling it spawn
#[allow(dead_code)]
async fn process(
    db: Pool<Postgres>,
    user_id: String,
    first_name: Option<String>,
    last_name: Option<String>,
) -> Result<Response, Response> {
    update_user_name(&db, &user_id, first_name, last_name)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, user_id, "failed to update user name");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}

/// Update user's name
#[tracing::instrument(skip(ctx, req, _internal_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_access: ValidInternalKey,
    extract::Json(req): extract::Json<UpdateNameWebhook>,
) -> Result<Response, Response> {
    let user_id = "macro|".to_string() + &req.email;
    let first_name = req.first_name;
    let last_name = req.last_name;

    tokio::spawn(process(ctx.db.clone(), user_id, first_name, last_name));
    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
