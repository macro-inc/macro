use crate::api::context::ApiContext;
use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::{
    authentication::webhooks::populate_jwt::{PopulateJwtWebhook, PopulateJwtWebhookResponse},
    user::UserInfoWithMacroUserId,
};

/// Populate user jwt webhook
#[tracing::instrument(skip(ctx, req, _internal_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_access: ValidInternalKey,
    extract::Json(req): extract::Json<PopulateJwtWebhook>,
) -> Result<Response, Response> {
    let email = req.email.to_lowercase();

    tracing::trace!(email, "populating user");

    let UserInfoWithMacroUserId {
        id: user_id,
        organization_id,
        email: _,
        macro_user_id,
    } = macro_db_client::user::get::get_user_info_by_email(&ctx.db, &email)
        .await
        .map_err(|e| {
            tracing::error!(email, "failed to get user info");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    Ok((
        StatusCode::OK,
        Json(PopulateJwtWebhookResponse {
            user_id,
            organization_id,
            root_macro_id: macro_user_id,
        }),
    )
        .into_response())
}
