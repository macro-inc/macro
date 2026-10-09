use crate::api::context::{ApiContext, AuthorizationService};
use axum::Extension;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use models_email::service::link::Link;
use uuid::Uuid;

/// Delete a label.
#[utoipa::path(
    delete,
    tag = "Labels",
    path = "/email/labels/{id}",
    operation_id = "delete_label",
    params(
        ("id" = Uuid, Path, description = "Label ID."),
    ),
    responses(
            (status = 204, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
    Path(label_id): Path<Uuid>,
) -> Result<Response, Response> {
    ctx.mailbox_settings
        .delete_label(
            &authorization.authorization.user.macro_user_id,
            link.id,
            label_id,
        )
        .await
        .map_err(super::settings_error)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
