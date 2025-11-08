use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sqlx::PgPool;

use crate::{
    config::Config,
    model::{request::delete_user::DeleteUserRequest, response::EmptyResponse},
};

use model::user::UserContext;

/// Deletes the user. This action cannot be undone as it queues the user for deletion.
#[utoipa::path(
        delete,
        path = "/users",
        responses(
            (status = 200),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db, config, user_context, req), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id, delete_user_id=%req.user_id))]
pub async fn delete_user_handler(
    State(db): State<PgPool>,
    State(config): State<Arc<Config>>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<DeleteUserRequest>,
) -> Result<Response, Response> {
    // Ensure the user is in the organization
    let user_organization_id: i32 =
        match macro_db_client::user::get::get_user_organization::get_user_organization(
            &db,
            req.user_id.as_str(),
        )
        .await
        {
            Ok(result) => {
                if let Some(organization_id) = result {
                    organization_id
                } else {
                    tracing::error!("user not in organization");
                    return Err(StatusCode::UNAUTHORIZED.into_response());
                }
            }
            Err(e) => {
                tracing::error!(error=?e, "unable to get user organization");
                let result = match e {
                    sqlx::Error::RowNotFound => StatusCode::NOT_FOUND,
                    _ => StatusCode::INTERNAL_SERVER_ERROR,
                }
                .into_response();
                return Err(result);
            }
        };

    if user_organization_id
        != user_context
            .organization_id
            .expect("organization ID must be supplied")
    {
        tracing::error!("user not in same organization");
        return Err(StatusCode::UNAUTHORIZED.into_response());
    }

    delete_user(&config, &req.user_id).await.map_err(|e| {
        tracing::error!(error=?e, "unable to delete user");
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

/// Calls DSS to delete the user's documents and then will delete the user from the database.
#[tracing::instrument(skip(auth_context))]
async fn delete_user(auth_context: &Config, user_to_delete: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let start_time_dss = std::time::Instant::now();
    // Delete user DSS items through DSS API
    let url_encoded_user_id = urlencoding::encode(user_to_delete);
    let res = client
        .delete(format!(
            "{}/internal/users/{url_encoded_user_id}",
            auth_context.dss_url
        ))
        .header(
            "x-document-storage-service-auth-key",
            auth_context.internal_api_secret_key.as_ref(),
        )
        .header("User-Agent", "organization-service")
        .send()
        .await?;
    tracing::trace!(elapsed = ?start_time_dss.elapsed(), "delete user DSS complete");

    if res.status() != reqwest::StatusCode::OK {
        tracing::error!(status=?res.status(), "failed to delete dss");
        return Err(anyhow::anyhow!(
            "status:{} response:{}",
            res.status(),
            res.text().await?
        ));
    }

    let start_time_auth = std::time::Instant::now();
    // Delete user DSS items through DSS API
    let res = client
        .delete(format!("{}/webhooks/user", auth_context.auth_url))
        .body(serde_json::to_string(&DeleteUserRequest {
            user_id: user_to_delete.to_string(),
        })?)
        .header(
            "x-internal-auth-key",
            auth_context.auth_internal_auth_secret_key.as_ref(),
        )
        .header("User-Agent", "organization-service")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .send()
        .await?;
    tracing::trace!(elapsed = ?start_time_auth.elapsed(), "delete user auth complete");

    if res.status() != reqwest::StatusCode::OK {
        tracing::error!(status=?res.status(), "failed to delete auth");
        return Err(anyhow::anyhow!(
            "status:{} response:{}",
            res.status(),
            res.text().await?
        ));
    }

    Ok(())
}
