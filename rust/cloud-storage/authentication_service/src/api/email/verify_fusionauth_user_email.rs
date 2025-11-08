use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};

use crate::api::{context::ApiContext, utils::default_redirect_url};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub verification_id: String,
}

/// Verifies the user's primary email for FusionAuth
#[utoipa::path(
        get,
        path = "/email/fusionauth/verify/{verification_id}",
        params(
            ("verification_id" = String, Path, description = "The verification id")
        ),
        operation_id = "verify_fusionauth_user_email",
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
    tracing::info!("verify_fusionauth_user_email");

    // Verify through fusionauth
    // This will trigger the user.email.verify event in FusionAuth to call our webhook to update
    // macro_user_email_verification table
    ctx.auth_client
        .verify_email(&verification_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to verify email");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to verify email").into_response()
        })?;

    let redirect_url = format!("{}/login", default_redirect_url());

    Ok(Redirect::to(&redirect_url).into_response())
}
