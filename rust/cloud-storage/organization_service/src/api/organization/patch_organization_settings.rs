use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    api::context::ApiContext,
    model::{
        request::patch_organization_settings::PatchOrganizationSettingsRequest,
        response::EmptyResponse,
    },
};

use model::user::UserContext;

/// Patches the organization settings
#[utoipa::path(
        patch,
        path = "/organization/settings",
        responses(
            (status = 200),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context,req), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id))]
pub async fn patch_organization_settings_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<PatchOrganizationSettingsRequest>,
) -> Result<Response, Response> {
    let mut transaction = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "failed to begin transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to update organization settings",
        )
            .into_response()
    })?;

    if let Some(remove_organization_default_share_permission) = req.remove_default_share_permission
        && remove_organization_default_share_permission
    {
        macro_db_client::organization::remove::organization_default_share_permission::remove_organization_default_share_permission(
                &mut transaction,
                user_context.organization_id.expect("Organization ID must be supplied"),
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to remove organization default share permission");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to update organization settings",
                ).into_response()
            })?;
    }

    if let Some(remove_retention_days) = req.remove_retention_days {
        if remove_retention_days {
            macro_db_client::organization::remove::organization_retention_policy::remove_organization_retention_policy(
                    &mut transaction,
                    user_context.organization_id.expect("Organization ID must be supplied"),
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "failed to remove organization retention policy");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "unable to update organization settings",
                    ).into_response()
                })?;
        }
    } else if let Some(retention_days) = req.retention_days {
        macro_db_client::organization::patch::organization_retention_policy::patch_organization_retention_policy(
            &mut transaction,
            user_context.organization_id.expect("Organization ID must be supplied"),
            retention_days,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to update organization retention policy");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to update organization settings",
            ).into_response()
        })?;
    }

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "failed to commit transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to update organization settings",
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
