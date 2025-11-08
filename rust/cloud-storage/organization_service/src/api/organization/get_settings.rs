use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{api::context::ApiContext, model::organization::OrganizationSettingsResponse};
use model::user::UserContext;

/// Gets the organizations settings
#[utoipa::path(
        get,
        path = "/organization/settings",
        responses(
            (status = 200, body=OrganizationSettingsResponse),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id))]
pub async fn get_settings_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<impl IntoResponse, Response> {
    let settings = macro_db_client::organization::get::settings::get_organization_settings(
        ctx.db.clone(),
        user_context
            .organization_id
            .expect("Organization ID must be supplied"),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get organization settings");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get organization settings",
        )
            .into_response()
    })?;

    Ok((
        StatusCode::OK,
        Json(OrganizationSettingsResponse::from(settings)),
    ))
}
