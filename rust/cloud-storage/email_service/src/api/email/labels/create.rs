use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use model::user::UserContext;
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
            (status = 409, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link, gmail_token), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Json(request_body): Json<CreateLabelRequest>,
) -> Result<Response, Response> {
    let created_label = ctx
        .gmail_client
        .create_label(gmail_token.as_str(), link.id, &request_body.label_name)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "gmail call to create label failed");
            match e {
                gmail_client::GmailError::Conflict(_) => (
                    StatusCode::CONFLICT,
                    Json(ErrorResponse {
                        message: "label with that name already exists",
                    }),
                ),
                _ => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "create label call failed",
                    }),
                ),
            }
            .into_response()
        })?;

    let inserted_label = email_db_client::labels::insert::insert_label(&ctx.db, created_label)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to insert label");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to insert label",
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
