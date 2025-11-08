use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};

use crate::{
    api::{context::ApiContext, utils::default_redirect_url},
    service::user::create_user::create_user_profile,
};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub verification_id: String,
}

/// Verifies the user's email for a user profile
#[utoipa::path(
        get,
        path = "/email/verify/{verification_id}",
        params(
            ("verification_id" = String, Path, description = "The verification id")
        ),
        operation_id = "verify_email_link",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context), fields(client_ip=%ip_context.client_ip))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    extract::Path(Params { verification_id }): extract::Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("verify_email_link");

    // verify email
    let link = macro_db_client::in_progress_email_link::get_in_progress_email_link(
        &ctx.db,
        &verification_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get in progress email link");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to get in progress email link",
        )
            .into_response()
    })?;

    let link = match link {
        Some(link) => link,
        None => {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: "invalid verification id",
                }),
            )
                .into_response());
        }
    };

    // check if user already exists
    match macro_db_client::user::get::get_user_id_by_email(ctx.db.clone(), &link.email).await {
        Ok(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "cannot verify email link. user profile already exists. use account merge instead",
                }),
            )
                .into_response());
        }
        Err(e) => {
            match e {
                sqlx::Error::RowNotFound => {} // we want this
                _ => {
                    tracing::error!(error=?e, "unable to get user by email");
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to get user by email",
                    )
                        .into_response());
                }
            }
        }
    }

    // set email link to validated
    macro_db_client::macro_user_email_verification::upsert_macro_user_email_verification(
        &ctx.db,
        &link.macro_user_id.to_string(),
        &link.email,
        true,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to insert macro user email verification");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to insert macro user email verification",
        )
            .into_response()
    })?;

    // create new user profile
    create_user_profile(&link.macro_user_id.to_string(), &link.email, &ctx.db)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to insert macro user email verification");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to insert macro user email verification",
            )
                .into_response()
        })?;

    // delete link
    if let Err(e) = macro_db_client::in_progress_email_link::delete_in_progress_email_link(
        &ctx.db,
        &verification_id,
    )
    .await
    {
        tracing::error!(error=?e, "failed to delete in progress email link");
    }

    Ok(Redirect::to(default_redirect_url().as_str()).into_response())
}
