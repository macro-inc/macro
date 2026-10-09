use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use models_email::service;
use models_email::service::link::Link;
use utoipa::ToSchema;

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct CreateLabelRequest {
    pub label_name: String,
}

/// The response returned from the create label endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct CreateLabelResponse {
    /// Local label. Pending provider creation is reported by settings operations.
    pub label: service::label::Label,
}

/// Create a label.
#[utoipa::path(
    post,
    tag = "Labels",
    path = "/email/labels",
    operation_id = "create_label",
    request_body = CreateLabelRequest,
    responses(
            (status = 201, body=CreateLabelResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 409, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
    Json(request_body): Json<CreateLabelRequest>,
) -> Result<Response, Response> {
    let label = ctx
        .mailbox_settings
        .create_label(
            &authorization.authorization.user.macro_user_id,
            link.id,
            &request_body.label_name,
        )
        .await
        .map_err(super::settings_error)?;
    Ok((StatusCode::CREATED, Json(CreateLabelResponse { label })).into_response())
}
