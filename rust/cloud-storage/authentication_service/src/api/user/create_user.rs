use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
};

/// The request body to create a new user in fusionauth
/// NOTE: Never derive debug here as we don't want to accidentally log the password
#[derive(Default, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct CreateUserRequest {
    /// The unique username for the user.
    pub username: String,
    /// The primary email address of the user.
    /// This will be the user's root "profile".
    pub email: String,
    /// The password for the user.
    /// TODO: configure password policy and validate password before attempting to create user
    pub password: String,
}

/// Creates a new user.
#[utoipa::path(
        post,
        path = "/user",
        operation_id = "create_user",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, req), fields(client_ip=%ip_context.client_ip))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    extract::Json(req): extract::Json<CreateUserRequest>,
) -> Result<Response, Response> {
    tracing::info!("create_user");
    let email = req.email.to_lowercase();

    let username_exists =
        macro_db_client::macro_user::check_username_exists(&ctx.db, &req.username)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to check if username exists");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to check if username exists",
                )
                    .into_response()
            })?;

    if username_exists {
        return Err((
            StatusCode::BAD_REQUEST,
            "username already exists".to_string(),
        )
            .into_response());
    }

    let email_exists = macro_db_client::macro_user::check_email_exists(&ctx.db, &email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to check if email exists");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to check if email exists",
            )
                .into_response()
        })?;

    if email_exists {
        return Err((StatusCode::BAD_REQUEST, "email already exists".to_string()).into_response());
    }

    ctx.auth_client
        .create_user(
            crate::service::fusionauth_client::user::create::User {
                email: email.into(),
                password: req.password.into(),
                username: Some(req.username.into()),
            },
            false,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create user");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to create user").into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
