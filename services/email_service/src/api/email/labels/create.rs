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
    /// the thread, with messages inside
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
    let created_label = ctx
        .email_api
        .create_label(link.id, &request_body.label_name)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "email provider call to create label failed");
            let status = crate::api::email::provider_error::provider_error_status(&e);
            let message = if status == StatusCode::CONFLICT {
                "label with that name already exists"
            } else {
                "create label call failed"
            };
            (
                status,
                crate::api::email::provider_error::provider_error_headers(&e),
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response()
        })?;

    let inserted_label = email_db_client::labels::insert::insert_label(&ctx.db, created_label)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to insert label");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to insert label".into(),
                }),
            )
                .into_response()
        })?;

    Ok((
        StatusCode::CREATED,
        Json(CreateLabelResponse {
            label: inserted_label,
        }),
    )
        .into_response())
}
